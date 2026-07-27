# apps/gateway — reglas específicas

Cloudflare Worker. Es la **única** pieza pública de Luxy. Complementa el
`CLAUDE.md` de la raíz; aquí solo lo que es propio del gateway.

## Reglas innegociables

1. **El gateway no ejecuta código local.** Nada de `child_process`, nada de
   `node:fs`. Si un cambio parece necesitarlo, va en `apps/agent`.
2. **La `service_role` de Supabase solo existe aquí**, como secret de
   Cloudflare. Nunca se envía a una máquina ni aparece en una respuesta.
3. **Todos los endpoints `/api/*` requieren autenticación.** Usa
   `withMachineAuth`. Además, una máquina solo puede tocar **sus propios**
   trabajos: comprueba siempre `job.claimedBy === machine.id`.
4. **Los updates de Telegram deben ser idempotentes.** `repo.registerUpdate()`
   antes de procesar nada. Un `update_id` repetido se ignora entero.
5. **Los errores que ve el usuario van redactados.** Nunca devuelvas una traza
   ni el cuerpo crudo de un error de Supabase.

## Entorno de ejecución

Es un Worker, no Node:

- Solo APIs web: `fetch`, `crypto.subtle`, `Request`, `Response`, `URL`.
- No hay `Buffer`, ni `fs`, ni `process.env` (las variables llegan en `env`).
- `moduleResolution: Bundler` y `module: ESNext` en su `tsconfig.json`.
- El estado en memoria **no persiste** entre isolates.

## El webhook siempre responde 200

`/telegram/webhook` devuelve 200 salvo que falle el secret token. Si devolviera
un error, Telegram reintentaría el mismo update en bucle. Los fallos se
registran y, si se puede, se avisa al usuario por mensaje.

## Límites de Telegram

- 4096 caracteres por mensaje → usa `splitMessage` / `splitAsCodeBlocks`.
- `callback_data` máximo **64 bytes** → `buildCallbackData` lo verifica y lanza
  si te pasas. Por eso los botones de máquina usan el **nombre**, no el UUID.
- Editar con el mismo texto devuelve error: `editMessageText` lo trata como
  "no modificado", que no es un fallo.
- El progreso se emite **editando el mensaje existente**, como mucho cada
  `MIN_PROGRESS_EDIT_INTERVAL_MS` (1,5 s). No envíes mensajes nuevos por cada
  evento.

## El resultado final no se pierde

`deliverFinalMessage` intenta editar y, si falla, envía un mensaje nuevo. Si
también falla, se registra el error: **el resultado ya está persistido en
Supabase** antes de intentar entregarlo, así que `/job <id>` lo recupera.

Orden correcto al cerrar un trabajo: primero `updateJob`, después Telegram.

## Añadir un endpoint

1. Manejador en `handlers/api.ts`, envuelto en `withMachineAuth`.
2. Esquema Zod del cuerpo en `packages/shared/src/schemas.ts`.
3. Ruta en `src/index.ts`.
4. Documéntalo en `docs/CLOUDFLARE.md`.
5. Tests en `gateway.test.ts`.

## Rate limiting

`SlidingWindowRateLimiter` vive en memoria del isolate, así que el límite es
**por isolate** y aproximado. Está bien para frenar bucles. Si algún día hace
falta exactitud, hay que pasarlo a un Durable Object; no intentes arreglarlo
con más estado en memoria.

## Probar sin desplegar

```powershell
cd apps\gateway
npm run dry-run      # compila y empaqueta, no sube nada
npx wrangler dev     # local, con .dev.vars
```

**No ejecutes `wrangler deploy`** salvo que el usuario lo pida.
