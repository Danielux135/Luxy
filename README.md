# Luxy

Aplicación de escritorio para Windows que crea, ejecuta y supervisa tareas sobre
tus proyectos. **Luxy Studio** es la interfaz principal; Telegram queda como
canal secundario para órdenes rápidas y avisos. El trabajo se ejecuta en el
ordenador elegido mediante **Claude Code**, **Codex CLI** o modelos configurables.

```
Studio / Telegram ──► gateway ──► tu ordenador ──► worktree aislado ──► diff
```

---

## 1. Qué es Luxy

Cuatro piezas:

- **Luxy Desktop / Studio**: crea tareas y conversaciones, compara dos modelos,
  muestra progreso, resultados, pruebas y resumen del diff; además se queda en
  la bandeja. Ver [docs/DESKTOP.md](docs/DESKTOP.md).
- **Gateway** (Cloudflare Worker): autentica Studio y Telegram y mantiene la cola.
- **Supabase**: guarda el estado compartido, los trabajos y la auditoría.
- **Agente local**: hace el trabajo de verdad, en su propio proceso.

La CLI sigue existiendo como herramienta avanzada y de recuperación, pero ya no es
el flujo normal.

El ordenador **solo hace conexiones salientes HTTPS**. No abre puertos, no
necesita IP pública y no expone nada a Internet.

### Instalación rápida

Ejecuta `Luxy Setup 0.1.0.exe` y sigue el asistente de seis pasos: máquina,
herramientas, conexión de API, modelos, proyectos y resumen. No hace falta
PowerShell. Ver [docs/INSTALLATION.md](docs/INSTALLATION.md).

Las claves se guardan **cifradas** con tu cuenta de Windows y no vuelven a pedirse.

### Documentación

| Documento                                                       | De qué trata                                          |
| --------------------------------------------------------------- | ----------------------------------------------------- |
| [PROJECT-STATE.md](PROJECT-STATE.md)                            | estado canónico, incidencias y checkpoint actual      |
| [CURRENT-TASK.md](CURRENT-TASK.md)                              | siguiente bloque de trabajo sin rehacer investigación |
| [MASTER-PLAN.md](MASTER-PLAN.md)                                | fases, prioridades y criterios de aceptación          |
| [DECISIONS.md](DECISIONS.md)                                    | decisiones vinculantes y su motivo                    |
| [AI-WORK-PROTOCOL.md](AI-WORK-PROTOCOL.md)                      | relevo y documentación entre Claude y Codex           |
| [DESKTOP.md](docs/DESKTOP.md)                                   | la aplicación, su arquitectura y su seguridad         |
| [INSTALLATION.md](docs/INSTALLATION.md)                         | instalar y configurar                                 |
| [ARRANQUE-ORDENADOR-NUEVO.md](docs/ARRANQUE-ORDENADOR-NUEVO.md) | levantar el entorno completo desde un clon limpio     |
| [MODELS.md](docs/MODELS.md)                                     | catálogo, alias y qué funciona de verdad              |
| [AGENT_TOOLS.md](docs/AGENT_TOOLS.md)                           | las herramientas, el confinamiento y las aprobaciones |
| [SECURITY.md](docs/SECURITY.md)                                 | modelo de amenazas                                    |
| [TELEGRAM.md](docs/TELEGRAM.md)                                 | comandos                                              |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)                   | qué hacer cuando algo falla                           |

## 2. Qué puede hacer

- Crear y seguir tareas desde Studio en Windows o enviar órdenes rápidas desde Telegram.
- Conversar con un modelo o comparar dos respuestas, con streaming, tiempos e
  historial guardado automáticamente.
- Aislar cada tarea en un **worktree de git**, sin tocar tu carpeta de trabajo.
- Ejecutar las pruebas del proyecto solo con permiso explícito `allowHostChecks`.
- Enseñarte el resumen del diff y dejarte aplicar o descartar los cambios desde Desktop.
  Aplicar crea un commit en la rama aislada; no hace `push` ni toca producción.
- Elegir proveedor automáticamente con `/auto`.
- Cancelar una tarea a medias **conservando siempre los cambios**.

## 3. Arquitectura

```
Studio / Telegram
   ↓  HTTPS
Cloudflare Worker  (API de Studio, webhook, cola)
   ↓
Supabase           (cola de trabajos, leases, auditoría)
   ↓  polling saliente
Agente local       (tu PC o tu portátil)
   ↓
Claude Code / Codex CLI / APIs HTTP
   ↓
Resultados de vuelta a Studio y, cuando proceda, Telegram
```

Detalle completo en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 4. Requisitos

En **cada** ordenador donde quieras usar Luxy:

| Requisito       | Obligatorio | Para qué           |
| --------------- | ----------- | ------------------ |
| Node.js 20+     | sí          | ejecutar Luxy      |
| Git             | sí          | worktrees aislados |
| Claude Code CLI | opcional    | proveedor `claude` |
| Codex CLI       | opcional    | proveedor `codex`  |
| Flutter         | opcional    | proyectos Flutter  |

Servicios externos que tienes que crear tú:

- Un bot de Telegram (gratis).
- Un proyecto de Supabase (plan gratuito suficiente).
- Una cuenta de Cloudflare Workers (plan gratuito suficiente).

## 5. Instalación

```powershell
Set-Location "<ruta-del-proyecto>\Luxy"
npm install
npm run build
```

Comprueba que todo funciona sin tocar ningún servicio externo:

```powershell
npm test
npm run demo
```

`npm run demo` simula un trabajo completo (worktree, proveedor, pruebas, diff)
**sin consumir ninguna API ni credencial**.

En **Trabajos**, «Preparar carpeta» crea el worktree antes de enviar el prompt.
Puedes abrirlo, añadir archivos de contexto y mantenerlo seleccionado para
varios trabajos. Desde el detalle de cualquier trabajo también puedes elegir
«Continuar en este worktree».

## 6. Configuración de Telegram

1. Habla con [@BotFather](https://t.me/BotFather) y usa `/newbot`.
2. Guarda el token que te da. Es `TELEGRAM_BOT_TOKEN`.
3. Pide tu id numérico a [@userinfobot](https://t.me/userinfobot). Es `TELEGRAM_ADMIN_USER_ID`.
4. Genera un secreto para el webhook:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Detalle completo en [docs/TELEGRAM.md](docs/TELEGRAM.md).

## 7. Configuración de Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Abre **SQL Editor** y ejecuta, **en orden**:
   - `supabase/migrations/0001_luxy_initial_schema.sql`
   - `supabase/migrations/0002_luxy_job_claim.sql`
   - `supabase/migrations/0003_luxy_model_registry.sql`
   - `supabase/migrations/0005_luxy_studio_jobs.sql`

`0004_luxy_remote.sql` pertenece al módulo Remote pausado y no es requisito de
Studio. `0005` está preparada en el repositorio, pero no se aplica automáticamente.

3. Copia de **Settings → API**:

- `Project URL` → `SUPABASE_URL`
- `service_role` → `SUPABASE_SERVICE_ROLE_KEY`

> La `service_role` **solo** va como secret de Cloudflare. Nunca en tus ordenadores.

Detalle en [docs/SUPABASE.md](docs/SUPABASE.md).

## 8. Configuración de Cloudflare

```powershell
cd apps\gateway
Copy-Item wrangler.toml.example wrangler.toml
npx wrangler login
```

Carga los secretos uno a uno:

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_ADMIN_USER_ID
npx wrangler secret put TELEGRAM_ALLOWED_CHAT_IDS
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put MACHINE_REGISTRATION_SECRET
```

Despliega y registra el webhook:

```powershell
npx wrangler deploy
```

En Windows también puedes ejecutar `deploy-gateway.bat`. Primero compila y hace
un dry-run; sólo despliega después de escribir `DESPLEGAR`. Conserva variables y
secretos remotos y nunca aplica migraciones. `deploy-gateway.bat check` realiza
únicamente las comprobaciones.

Detalle en [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md).

## 9 y 10. Configuración del PC y del portátil

El mismo comando en cada equipo:

```powershell
npm run setup:machine
```

Te pregunta el nombre de la máquina (`casa`, `portatil`, `clase`...), la URL del
gateway, el secreto de registro y los proyectos con sus rutas locales.

**El mismo alias puede apuntar a rutas distintas en cada ordenador:**

```
PC:        errorlux → D:\Proyectos\Errorlux
Portátil:  errorlux → C:\Trabajo\Errorlux
```

Las rutas se guardan en `%APPDATA%\Luxy\config.json`, **nunca en el repositorio**.

Guía paso a paso en [docs/SETUP_WINDOWS.md](docs/SETUP_WINDOWS.md).

## 11. Inicio de sesión en Claude Code

Claude Code usa **la sesión local de tu suscripción**. Luxy nunca usa
`ANTHROPIC_API_KEY`. Hay que autenticarse **una vez en cada ordenador**:

```powershell
npm install -g @anthropic-ai/claude-code
claude          # sigue el flujo de login y luego sal con /exit
claude doctor   # comprueba que la instalación está sana
```

## 12. Inicio de sesión en Codex

Codex usa **la sesión local de tu cuenta de ChatGPT**. Luxy nunca usa
`OPENAI_API_KEY`. También hay que autenticarse una vez por ordenador:

```powershell
npm install -g @openai/codex
codex           # sigue el flujo de login
codex --version
```

## 13, 14 y 15. DeepSeek, GLM y Qwen

```powershell
Copy-Item .env.providers.example .env.providers
notepad .env.providers
```

Pon ahí tus claves. Después edita `%APPDATA%\Luxy\config.json` y rellena
`baseUrl` y `model` de cada proveedor (vienen como `PENDIENTE` a propósito,
porque esos valores cambian con el tiempo):

```json
{
  "id": "deepseek",
  "baseUrl": "https://LA_URL_ACTUAL/v1",
  "model": "EL_MODELO_ACTUAL",
  "enabled": true,
  "dailyBudget": 20
}
```

`dailyBudget: 0` significa sin límite. Ver [docs/PROVIDERS.md](docs/PROVIDERS.md).

## 16. Inicio manual

```powershell
.\scripts\start-luxy.ps1
```

O haz **doble clic** en `scripts\start-luxy.cmd`.

Deja ese ordenador encendido. Detén Luxy con `Ctrl+C`.

### Atajos sin terminal para Luxy Studio

En la raíz del worktree de Studio hay tres archivos para abrir con doble clic:

- `rebuild-luxy.bat`: reconstruye todos los paquetes.
- `start-luxy.bat`: abre el Desktop ya reconstruido desde esta carpeta.
- `rebuild-and-start-luxy.bat`: reconstruye y después abre Luxy.

Usa `rebuild-and-start-luxy.bat` después de cambiar código del agente, Desktop,
Gateway o `packages/shared`. Usa `start-luxy.bat` cuando no haya cambios y sólo
quieras volver a abrir el programa. Los archivos calculan su propia ubicación,
por lo que no dependen de la carpeta actual de Windows.

## 17. Autoarranque opcional

**No se activa solo.** Solo si lo ejecutas tú:

```powershell
# al iniciar sesión, solo con corriente (valores por defecto seguros)
.\scripts\install-autostart.ps1

# también con batería
.\scripts\install-autostart.ps1 -OnBattery

# al arrancar Windows (requiere consola de administrador)
.\scripts\install-autostart.ps1 -Trigger Startup
```

Para quitarlo:

```powershell
.\scripts\uninstall-autostart.ps1
```

## 18. Comandos de Telegram

```
/start              /help
/status             estado y trabajos activos
/machines           máquinas y si están conectadas
/use <maquina>      fija tu máquina preferida
/projects           alias configurados
/providers          proveedores por máquina

/claude   <proyecto> <tarea>
/codex    <proyecto> <tarea>
/deepseek <proyecto> <tarea>
/glm      <proyecto> <tarea>
/qwen     <proyecto> <tarea>
/auto     <proyecto> <tarea>    Luxy elige el proveedor y explica por qué

/cancel [ID]        cancela conservando los cambios
/job <ID>           detalle de un trabajo
/logs <ID>          últimos eventos
```

Ejemplos:

```
/claude errorlux Corrige el problema por el que el Quick Pick no abre la solución,
ejecuta las pruebas y enséñame el diff.

/codex portfolio Revisa el responsive de los menús y corrige cualquier desbordamiento.
```

En grupos también funciona en lenguaje natural:

```
@LuxyBot Claude, revisa Errorlux y arregla el Quick Pick.
@LuxyBot usa Codex en portfolio para corregir el responsive.
```

En grupos Luxy **ignora** los mensajes que no le mencionen y **nunca** ejecuta
instrucciones de otros miembros. Ver [docs/TELEGRAM.md](docs/TELEGRAM.md).

## 19. Flujo de aprobaciones

En Studio, un trabajo terminado con cambios ofrece `Aplicar cambios` y
`Descartar trabajo`. Las dos acciones piden confirmación. La primera crea el
commit en la rama aislada de Luxy; la segunda elimina el worktree. Studio no
ofrece `push` en este flujo.

Cuando un trabajo termina con cambios, Telegram te ofrece:

```
[Ver diff]  [Ver pruebas]
[Crear commit]  [Descartar cambios]
[Solicitar push]
```

- **Los commits nunca son automáticos.** Requieren que pulses el botón.
- **El push nunca es automático.** Requiere **dos** acciones explícitas
  (`Solicitar push` → `Confirmar push`) **y** que `allowPush` esté a `true`
  en la configuración de esa máquina. Viene a `false` por defecto.
- Cada aprobación queda auditada en la tabla `approvals`.

## 20. Seguridad

Resumen (completo en [docs/SECURITY.md](docs/SECURITY.md)):

- Lista blanca de usuarios y chats de Telegram.
- Secret token en el webhook.
- Tokens de máquina guardados **solo como hash SHA-256**.
- Idempotencia por `update_id`: un mensaje nunca se ejecuta dos veces.
- RLS activo en Supabase; `anon` y `authenticated` sin ningún permiso.
- `spawn` con argumentos separados, **nunca** `exec` ni `shell`.
- El entorno completo **nunca** se pasa a un proceso hijo ni a un modelo.
- Redacción de secretos en todo lo que sale por logs, eventos o Telegram.
- Lista blanca de proyectos y de comandos de comprobación.
- Protección contra path traversal y contra enlaces simbólicos que salgan del worktree.
- El contenido de Telegram y de los archivos se trata como **dato no confiable**.

## 21. Actualización

```powershell
git pull
npm install
npm run build
npm test
```

Si hay migraciones nuevas en `supabase/migrations/`, ejecútalas en el SQL Editor
por orden de número. Si cambió el gateway: `cd apps\gateway; npx wrangler deploy`.

## 22. Copias de seguridad

Lo único irreemplazable es:

| Qué                               | Dónde                           |
| --------------------------------- | ------------------------------- |
| Configuración de la máquina       | `%APPDATA%\Luxy\config.json`    |
| Worktrees con cambios sin guardar | `%LOCALAPPDATA%\Luxy\worktrees` |
| Claves de las APIs                | `.env.providers`                |
| Datos de trabajos                 | Supabase (usa su backup)        |

```powershell
Copy-Item "$env:APPDATA\Luxy\config.json" "$env:USERPROFILE\Desktop\luxy-config-backup.json"
```

> Ese archivo contiene el token de la máquina. Trátalo como una contraseña.

## 23. Solución de problemas

**`/machines` dice que no hay ninguna máquina**
Ejecuta `npm run setup:machine` en el ordenador que quieras usar.

**La máquina aparece desconectada**
Luxy tiene que estar corriendo (`.\scripts\start-luxy.ps1`). Se considera
desconectada tras 45 s sin heartbeat.

**"Claude Code no tiene sesión iniciada"**
Ejecuta `claude` en una terminal de ese ordenador y autentícate. Las sesiones
son locales: hacerlo en el PC no sirve para el portátil.

**"Codex CLI no tiene sesión iniciada"**
Igual, con `codex`.

**El proyecto no es un repositorio git**
Luxy no edita fuera de un worktree. En esa carpeta:

```powershell
git init; git add -A; git commit -m "estado inicial"
```

**Los trabajos se quedan en cola**
Ninguna máquina compatible está conectada. Comprueba `/machines` y `/providers`.

**Ver los logs**

```powershell
Get-Content "$env:LOCALAPPDATA\Luxy\logs\luxy.log" -Tail 50
```

**Ver los logs del gateway**

```powershell
cd apps\gateway; npx wrangler tail
```

---

## Comandos del repositorio

```powershell
npm run lint        # eslint
npm run typecheck   # tsc en todo el monorepo
npm test            # vitest
npm run build       # compila todos los paquetes
npm run check       # los cuatro anteriores en orden
npm run demo        # demostración con mocks, sin consumir APIs
npm run setup:machine
```

## Licencia

Proyecto personal.
