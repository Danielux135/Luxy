# Configuración de Telegram

## 1. Crear el bot

1. Abre [@BotFather](https://t.me/BotFather).
2. `/newbot`.
3. Elige nombre y username. El username orientativo es `LuxyBot`, pero depende
   de disponibilidad: usa el que consigas y ponlo en `TELEGRAM_BOT_USERNAME`.
4. Guarda el token. Es `TELEGRAM_BOT_TOKEN`.

Recomendado, para que Telegram te sugiera los comandos:

```
/setcommands
```

Pega esto:

```
start - Comprobar que Luxy responde
help - Ver todos los comandos
status - Estado y trabajos activos
machines - Maquinas registradas
use - Fijar la maquina preferida
projects - Proyectos configurados
providers - Proveedores disponibles
claude - Ejecutar una tarea con Claude Code
codex - Ejecutar una tarea con Codex
deepseek - Ejecutar una tarea con DeepSeek
glm - Ejecutar una tarea con GLM
qwen - Ejecutar una tarea con Qwen
auto - Luxy elige el proveedor
cancel - Cancelar el trabajo activo
job - Ver el detalle de un trabajo
logs - Ver los eventos de un trabajo
```

En grupos, además: `/setprivacy` → **Disabled**, para que el bot reciba las
menciones en lenguaje natural.

## 2. Tu id de usuario

Habla con [@userinfobot](https://t.me/userinfobot). Te da un número:
es `TELEGRAM_ADMIN_USER_ID`.

## 3. Ids de chat autorizados

- **Chat privado**: el id del chat es tu propio id de usuario.
- **Grupo**: añade el bot al grupo, escribe algo y consulta:

```powershell
$token = "TU_TOKEN"
Invoke-RestMethod "https://api.telegram.org/bot$token/getUpdates" |
  Select-Object -ExpandProperty result |
  ForEach-Object { $_.message.chat }
```

Los ids de grupo son negativos (`-1001234567890`).

`TELEGRAM_ALLOWED_CHAT_IDS` acepta varios separados por coma:

```
111222333,-1001234567890
```

## 4. Secreto del webhook

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Es `TELEGRAM_WEBHOOK_SECRET`. Telegram lo enviará en cada petición y el gateway
rechaza cualquier webhook que no lo lleve.

## 5. Registrar el webhook

Después de desplegar el Worker:

```powershell
$token = "TU_TOKEN"
$secret = "TU_SECRETO_DEL_WEBHOOK"
$url = "https://luxy-gateway.TU-CUENTA.workers.dev/telegram/webhook"

Invoke-RestMethod -Method Post `
  -Uri "https://api.telegram.org/bot$token/setWebhook" `
  -ContentType "application/json" `
  -Body (@{
      url = $url
      secret_token = $secret
      allowed_updates = @("message", "callback_query")
      drop_pending_updates = $true
  } | ConvertTo-Json)
```

Comprobar:

```powershell
Invoke-RestMethod "https://api.telegram.org/bot$token/getWebhookInfo"
```

`pending_update_count` debe ser 0 y `last_error_message` estar vacío.

## 6. Comandos

### Informativos

| Comando | Qué hace |
|---|---|
| `/start` | comprueba que Luxy responde |
| `/help` | lista de comandos |
| `/status` | máquinas conectadas y trabajos activos |
| `/machines` | todas las máquinas, con su último contacto |
| `/use <maquina>` | fija tu máquina preferida |
| `/projects` | alias configurados y en qué máquinas |
| `/providers` | proveedores disponibles por máquina |

`/projects` **no muestra las rutas locales**: son específicas de cada equipo.

### Tareas

```
/claude <proyecto> <tarea>
/codex <proyecto> <tarea>
/deepseek <proyecto> <tarea>
/glm <proyecto> <tarea>
/qwen <proyecto> <tarea>
/auto <proyecto> <tarea>
```

`/auto` elige con un router determinista y te dice por qué:

```
Proveedor elegido: Claude
Motivo: la tarea requiere modificar varios archivos y ejecutar pruebas locales.
```

### Control

| Comando | Qué hace |
|---|---|
| `/cancel` | cancela el trabajo activo de tu máquina |
| `/cancel LUX-4F82` | cancela ese trabajo concreto |
| `/job LUX-4F82` | detalle completo |
| `/logs LUX-4F82` | últimos eventos |

## 7. Menciones naturales en grupos

```
@LuxyBot Claude, revisa Errorlux y arregla el Quick Pick.
@LuxyBot usa Codex en portfolio para corregir el responsive.
@LuxyBot analiza este error con DeepSeek.
```

Luxy busca el nombre del proveedor y el alias del proyecto dentro del texto.
Si hay varios alias parecidos, gana el más largo (`portfolio-v2` sobre
`portfolio`).

Reglas en grupos:

- Un mensaje **sin mención** y **sin comando** se ignora entero.
- Una **respuesta directa** a un mensaje del bot cuenta como mención.
- El texto citado se pasa al proveedor **marcado como dato**, nunca como orden.
- **Solo el usuario administrador puede dar órdenes.** Los mensajes de otros
  miembros se ignoran aunque mencionen al bot.
- No se almacena la conversación: solo el prompt del trabajo.

## 8. Experiencia durante la ejecución

Al crear la tarea:

```
Trabajo creado

ID: LUX-4F82
Máquina: casa
Proyecto: errorlux
Agente: Claude
Estado: en cola
```

Durante la ejecución, Luxy **edita ese mismo mensaje** (como mucho cada 1,5 s):

```
Luxy está trabajando

ID: LUX-4F82
Máquina: casa
Proyecto: errorlux
Agente: Claude
Duración: 00:43
Fase: ejecutando las pruebas del proyecto
```

Al terminar:

```
Trabajo terminado

ID: LUX-4F82
Máquina: casa
Proyecto: errorlux
Agente: Claude
Duración: 08:21

Archivos modificados: 4
Pruebas superadas: 32
Pruebas fallidas: 0

Resumen:
Se corrigió la conservación de solutionId al seleccionar una solución.
```

Con botones:

```
[Ver diff]  [Ver pruebas]
[Crear commit]  [Descartar cambios]
[Solicitar push]
```

## 9. Flujo de push

`Solicitar push` → Luxy avisa de lo que va a pasar → `Confirmar push` / `Cancelar`.

Aun confirmando, la máquina rechaza el push si `allowPush` es `false` en su
`config.json`. **Viene a `false` por defecto.**

## 10. Problemas

**El bot no responde**

```powershell
Invoke-RestMethod "https://api.telegram.org/bot$token/getWebhookInfo"
```

Mira `last_error_message`. Y los logs del Worker:

```powershell
cd apps\gateway; npx wrangler tail
```

**Responde en privado pero no en el grupo**

Comprueba que el id del grupo está en `TELEGRAM_ALLOWED_CHAT_IDS` y que hiciste
`/setprivacy` → Disabled.

**"No estás autorizado"**

Tu `TELEGRAM_ADMIN_USER_ID` no coincide. Vuelve a consultarlo con @userinfobot.
