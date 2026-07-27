# Plantilla: añadir un comando de Telegram

## Objetivo

Describe el comando y qué debe responder.

> Ejemplo: `/worktrees` lista los worktrees vivos de la máquina seleccionada,
> con su rama y si tienen cambios.

Decide primero:
- ¿Es **de control** (responde información) o **de tarea** (lanza un trabajo)?
- ¿Lleva argumentos? ¿Cuáles son obligatorios?
- ¿Necesita datos que solo tiene el agente local? Entonces hace falta un
  endpoint o un tipo de trabajo, no solo un comando.

## Contexto necesario

- `packages/shared/src/telegram/commands.ts` — el parser.
- `apps/gateway/src/handlers/commands.ts` — los manejadores.
- `docs/TELEGRAM.md` — documentación de cara al usuario.

## Pasos

1. **Declara el comando** en `shared/telegram/commands.ts`:
   - de control → `CONTROL_COMMANDS`
   - de tarea → `TASK_COMMANDS`

2. **Manéjalo** en `handleControlCommand` (`gateway/handlers/commands.ts`).
   Devuelve `CommandReply` con `text` y, si hace falta, `keyboard`.

3. **Añádelo a `HELP_TEXT`**, en la sección que le corresponda.

4. **Documéntalo** en `docs/TELEGRAM.md` (tabla de comandos) y en el
   `README.md` (sección 18).

5. **Añádelo a la lista de `/setcommands`** de `docs/TELEGRAM.md`.

6. **Pruebas** en `commands.test.ts`.

## Si añade botones

- `buildCallbackData(accion, argumento)` — **límite duro de 64 bytes**. La
  función lanza si te pasas. Por eso los botones de máquina usan el nombre y no
  el UUID.
- Manéjalo en `handleCallbackQuery` (`gateway/handlers/callbacks.ts`).
- Llama siempre a `answerCallbackQuery`, aunque sea sin texto: si no, Telegram
  deja el reloj girando.

## Restricciones

- Valida los argumentos y da un mensaje de error **con el formato correcto**:

```ts
throw new CommandParseError('falta el proyecto', 'formato: /comando <proyecto> <tarea>');
```

- Respeta los límites de longitud (`MAX_PROMPT_LENGTH`).
- Las respuestas largas van con `splitMessage` o `splitAsCodeBlocks`.
- **Nunca muestres rutas locales de una máquina** en la respuesta: son
  específicas de cada equipo (mira cómo lo hace `/projects`).
- Comprueba siempre la autorización: ya la aplica el webhook, no la relajes.
- Si el comando puede tardar, responde de inmediato y actualiza después
  editando el mensaje.

## Pruebas requeridas

- Se parsea correctamente con y sin argumentos.
- Se parsea con `@NombreDelBot` y se ignora si el bot es otro.
- Argumentos inválidos producen `CommandParseError` con pista útil.
- Si es de tarea: alias con caracteres inválidos y prompt demasiado largo.
- El manejador devuelve el texto esperado con datos simulados.

## Verificación

```powershell
npm test
npm run lint
npm run typecheck
npm run build
```

## Formato del informe final

```
Comando añadido:
  /<nombre> — <qué hace>

Argumentos:
  <cuáles, obligatorios u opcionales>

Archivos modificados:
  <lista, incluida la documentación>

Pruebas añadidas:
  <cuáles>

Comprobaciones: lint / typecheck / test / build → resultado real

Nota:
  Recuerda actualizar /setcommands en @BotFather con la lista de docs/TELEGRAM.md
```
