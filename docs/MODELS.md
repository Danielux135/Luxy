# Modelos

## Tres conceptos distintos

Antes «proveedor» era a la vez el proveedor, el modelo y el comando de Telegram.
Ahora son tres cosas separadas:

| Concepto | Qué es | Dónde vive |
|---|---|---|
| **Conexión** | un endpoint con su clave y su dialecto | `config.json` + `secrets.enc` |
| **Modelo** | un `apiModel` concreto que sirve esa conexión | catálogo en `packages/shared/src/models` |
| **Alias** | el comando que escribes en Telegram | `telegramAliases` de cada modelo |

Una conexión sirve muchos modelos. Un modelo puede tener varios alias.

**El `apiModel` es exacto.** `DeepSeek-V4-Pro`, `Kimi-K2.6`, `kat-coder-pro-v2.5`:
no se normalizan mayúsculas, puntos ni guiones en ningún punto del camino. Hay
tests que lo fijan.

## Declarado no es disponible

Estar en el catálogo solo significa que Luxy sabe cómo pedir ese modelo. Para
poder usarlo hacen falta además:

1. conexión habilitada,
2. clave guardada,
3. que la conexión confirme que lo sirve.

`servedByConnection` es `boolean | null`. **`null` significa «aún no se ha
consultado», que no es lo mismo que «no está».** El botón *Sincronizar modelos* de
la vista de Conexiones consulta `/v1/models` y actualiza esa información.

## Catálogo

Verificado contra la conexión el **2026-07-28**. Los modelos con tool calling
nativo se comprobaron con llamadas reales.

### Texto y código

| Modelo | Comandos | Herramientas nativas |
|---|---|---|
| `DeepSeek-V4-Pro` | `/deepseek` `/deepseek_pro` | sí |
| `DeepSeek-V4-Flash` | `/deepseek_flash` | sí |
| `glm-5.2` | `/glm` `/glm_52` | sí, **lento (~120 s)** |
| `glm-5.1` | `/glm_51` | sí |
| `kat-coder-pro-v2.5` | `/kat` `/kat_v25` | **sin acceso en la cuenta** |
| `Kimi-K2.6` | `/kimi` `/kimi_k26` | sí |
| `MiniMax-M3` | `/minimax` `/minimax_m3` | sí, **muy lento (~240 s)** |
| `Qwen3.5-397B-A17B` | `/qwen` `/qwen_397b` | sí |
| `Qwen3.6-35B-A3B` | `/qwen_35b` `/qwen_36` | sí |
| `step-3.7-flash` | `/step` `/step_37` | sí |
| `step-3.5-flash` | `/step_35` | **no**, usa pseudo-XML |
| `step-3.5-flash-2603` | `/step_35_2603` | sí |

### Audio e imagen

| Modelo | Comando | Estado |
|---|---|---|
| `stepaudio-2.5-chat` | `/audio_chat` | verificado |
| `stepaudio-2.5-tts` | `/speak` | verificado |
| `stepaudio-2.5-asr` | `/transcribe` | **sin verificar**, ver AGENT_TOOLS |
| `stepaudio-2.5-realtime` | `/voice` | sin verificar |
| `step-image-edit-2` | `/image_edit` | verificado |

### Enrutado

`step-router-v1` y `auto` están registrados pero **desactivados** y sin comando de
Telegram. `/auto` usa el router determinista local salvo que los actives.

## Qué no está y por qué

Cuatro modelos de la especificación original no los sirve esta conexión, así que
no están en el catálogo: `kat-coder-pro-v2`, `MiniMax-M2.7`,
`sensenova-6.7-flash-lite` y `sensenova-u1-fast`. Sus alias (`/kat_v2`,
`/minimax_m27`, `/sensenova*`) **no resuelven**, y hay un test que lo comprueba.

`glm-5.1` y `auto` sí los sirve y no estaban en la lista original: se añadieron.

## Modelos lentos

`glm-5.2` y `MiniMax-M3` responden, pero tardan entre 2 y 4 minutos por turno. Una
primera medida con 45 segundos de margen los daba por caídos, y era un error de la
medida. Llevan `slowResponse: true` y su latencia observada.

**Consecuencia práctica:** un bucle agentic de 8 pasos con MiniMax son ~30 minutos.
El `jobTimeoutMs` por defecto es 1 hora, así que entra, pero conviene bajar
`maxToolSteps` para esos modelos.

## Alias sin versión

`/deepseek` no fija modelo: usa el predeterminado de la familia. `/deepseek_pro` sí
apunta al modelo concreto.

Eso es lo que te permite **cambiar el predeterminado sin cambiar el comando que
escribes**. Si mañana aparece DeepSeek V5, lo marcas como predeterminado y
`/deepseek proyecto tarea` empieza a usarlo.

## Añadir un modelo

1. Añade la entrada a `RAW_CATALOG` en `packages/shared/src/models/catalog.ts`.
2. Si su familia es nueva, añádela a `MODEL_FAMILIES` y a `PROVIDER_IDS`.
   TypeScript te obligará a completar `PROVIDER_LABELS` y `PROVIDER_ALIASES`.
3. Los alias entran solos en `TASK_COMMANDS`.
4. `npm test` — hay tests de unicidad de alias y de coherencia del catálogo.

No hace falta migración de base de datos: `jobs.provider` se valida por forma
desde `0003_luxy_model_registry.sql`.
