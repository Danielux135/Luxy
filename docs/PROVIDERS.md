# Proveedores de Luxy

Luxy tiene dos familias de proveedores, con reglas muy distintas.

## Familia 1: CLI local con sesión de suscripción

**Claude Code** y **Codex CLI**. Se ejecutan como procesos locales usando la
sesión que iniciaste en ese ordenador.

- **No se usa la API de Anthropic ni la de OpenAI.**
- **No se usa `ANTHROPIC_API_KEY` ni `OPENAI_API_KEY`.** Están además en la
  lista de variables que nunca se pasan a un proceso hijo.
- **No se automatiza ninguna página web** ni la interfaz visual de ChatGPT o Claude.
- La sesión es **local**: hay que autenticarse una vez en cada ordenador.

### Claude Code

```powershell
npm install -g @anthropic-ai/claude-code
claude          # login
claude doctor
```

Luxy detecta el ejecutable con `where.exe`, lee `claude --version` y
**analiza `claude --help` para saber qué flags admite realmente esa versión**.
No se copian flags de otra versión.

Invocación conceptual (los flags concretos dependen de lo detectado):

```
claude --print --model opus --output-format stream-json --verbose --disallowedTools ... <prompt>
```

- `--print`: no interactivo.
- `--model opus`: Opus cuando se pide Claude. Configurable en `config.json`.
- `--output-format stream-json`: solo si esa versión lo ofrece; si no, texto plano.
- `--disallowedTools`: prohíbe `git push`, `rm -rf` y `WebFetch`.
- **Nunca `--dangerously-skip-permissions`.** Hay una prueba que lo verifica.

Versión detectada durante el desarrollo: **2.1.183**.

### Codex CLI

```powershell
npm install -g @openai/codex
codex           # login con ChatGPT
```

Luxy lee `codex exec --help` para detectar capacidades.

```
codex exec --json --cd <worktree> --sandbox workspace-write --output-last-message <archivo> -
```

- `--cd <worktree>`: el sandbox queda limitado al worktree.
- `--sandbox workspace-write`: **nunca `danger-full-access`**.
- **Nunca `--dangerously-bypass-approvals-and-sandbox`.**
- El `-` final indica que el prompt llega **por stdin**, no por argumentos.
  Así ningún texto de Telegram puede confundirse con un flag.

Versión detectada durante el desarrollo: **0.141.0**.

## Familia 2: APIs HTTP configurables

**DeepSeek**, **GLM** y **Qwen**. Compatibles con el formato de OpenAI, pero
**sin usar el SDK oficial**: solo `fetch` nativo.

### Claves

```powershell
Copy-Item .env.providers.example .env.providers
notepad .env.providers
```

```
DEEPSEEK_API_KEY=tu-clave
GLM_API_KEY=tu-clave
QWEN_API_KEY=tu-clave
```

Las claves **solo** viven en ese archivo local. Nunca en `config.json`, ni en
Supabase, ni en git, ni en Telegram, ni en los logs. Al cargarse se registran en
`secretRegistry`, que las elimina de cualquier salida.

### URLs y modelos

**No están codificados a propósito**: cambian con el tiempo. Vienen como
`PENDIENTE` y los rellenas tú en `%APPDATA%\Luxy\config.json`:

```json
{
  "providers": {
    "http": [
      {
        "id": "deepseek",
        "displayName": "DeepSeek",
        "baseUrl": "https://LA_URL_ACTUAL/v1",
        "model": "EL_MODELO_ACTUAL",
        "apiKeyEnv": "DEEPSEEK_API_KEY",
        "enabled": true,
        "supportsStreaming": true,
        "maxOutputTokens": 8192,
        "dailyBudget": 20
      }
    ]
  }
}
```

Consulta la documentación oficial de cada servicio para los valores actuales.
Luxy llama a `<baseUrl>/chat/completions`.

### Qué implementan

- Streaming SSE (`stream: true`), con progreso cada ~400 caracteres.
- Timeout por petición y cancelación vía `AbortSignal`.
- Reintentos limitados con backoff exponencial y jitter. **No** se reintenta un
  401 o un 400: no van a mejorar solos.
- Lectura de `usage` para registrar tokens.
- **Presupuesto diario** (`dailyBudget`). `0` = sin límite. El corte es por día
  UTC. Si se agota, la llamada se rechaza **antes** de gastar nada.
- Errores traducidos a lenguaje claro (clave rechazada, rate limit, error del
  servidor).

## Modo automático

`/auto <proyecto> <tarea>` usa un **router determinista**. No consulta ningún
modelo para decidir: es texto y reglas, así que es gratis e instantáneo.

| Señal en la petición | Proveedor |
|---|---|
| Petición explícita de proveedor | **se respeta siempre** |
| Cambios complejos en varios archivos | Claude |
| Corrección concreta y verificable | Codex |
| Análisis de logs o texto largo | DeepSeek / GLM |
| Documentación extensa | Qwen / GLM |
| Sin señales claras | Claude |

Nunca devuelve un proveedor que no esté instalado: si el pedido no está,
elige otro compatible **y lo explica**.

```
Proveedor elegido: Claude
Motivo: la tarea requiere modificar varios archivos y ejecutar pruebas locales.
```

## Ampliaciones preparadas

`packages/shared/src/router.ts` define las interfaces para lo que viene después,
aún **sin implementar**:

- `RoutingStrategy`: sustituir el router por otro.
- `CouncilStrategy`: consejo de agentes, comparación de respuestas, votaciones.
- `ProjectMemory`: memoria por proyecto entre trabajos.

`ProviderExecution` (en `types.ts`) es el contrato común: cualquier proveedor
nuevo solo tiene que implementar `detect()` y `run()`.

## Añadir un proveedor HTTP nuevo

1. Añade su configuración al array `providers.http` de `config.json`.
2. Añade su clave a `.env.providers` con el nombre que pusiste en `apiKeyEnv`.
3. Reinicia Luxy. `HttpApiProvider` es genérico: no hace falta tocar código.

Si el proveedor no habla el formato de OpenAI, implementa `ProviderExecution` en
`apps/agent/src/providers/` y regístralo en `agent.ts`.

## Problemas

**"Claude Code no tiene sesión iniciada"**
Ejecuta `claude` en ese ordenador. Las sesiones no se comparten entre equipos.

**"Codex CLI no tiene sesión iniciada"**
Ejecuta `codex` en ese ordenador.

**"falta la clave de DeepSeek"**
Falta `DEEPSEEK_API_KEY` en `.env.providers`, o su valor sigue siendo
`PENDIENTE_...` (se ignora a propósito).

**"presupuesto diario agotado"**
Sube `dailyBudget` o ponlo a `0` para quitar el límite.

**El proveedor no aparece en `/providers`**
Está deshabilitado, le falta la clave, o el CLI no se detectó. Arranca Luxy y
mira las líneas de detección del arranque.

---

## Actualización: conexiones y catálogo de modelos

Lo de arriba describe el esquema `providers.http`, que sigue funcionando. Pero el
modelo de datos ha cambiado: ahora se separan **conexión**, **modelo** y **alias**.

### Conexiones

Una conexión es un endpoint con su clave, su dialecto y su timeout. Sirve **muchos**
modelos. Se configura desde la vista de Conexiones de Luxy Desktop.

**La clave no está en la conexión.** Vive cifrada en `secrets.enc` bajo
`connection:<id>`, y el renderer solo llega a saber si está configurada o no. Para
cambiarla se introduce una nueva; nunca se muestra la guardada.

### Claude y Codex

No son conexiones y no llevan clave: usan **tu sesión local** del CLI. Luxy nunca
usa `ANTHROPIC_API_KEY` ni `OPENAI_API_KEY`, y `BASE_ENV_ALLOWLIST` las bloquea
explícitamente en el entorno de los procesos hijo.

### Migración desde `.env.providers`

Si Luxy encuentra claves en texto plano de una instalación anterior, el asistente
ofrece importarlas, cifrarlas y borrar el original. **No borra nada hasta
confirmar que la clave quedó guardada**: perder una clave por una decisión
automática sería irreversible.

### Modelos

El catálogo ya no es un modelo por proveedor. Ver [MODELS.md](MODELS.md) para el
catálogo verificado, los alias de Telegram y qué funciona de verdad hoy.

### Añadir una conexión

Desde la vista de Conexiones. El botón *Probar conexión* consulta `/v1/models` y
marca qué modelos sirve realmente — que no tiene por qué coincidir con el catálogo.

La URL que se prueba sale de la configuración guardada, **no de lo que mande la
interfaz**: si el renderer pudiera elegir el destino, podría mandar la clave
descifrada a donde quisiera.
