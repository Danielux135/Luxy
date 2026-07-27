# Plantilla: implementar una funcionalidad

## Objetivo

Describe **qué** debe poder hacer el usuario cuando esto esté terminado, no cómo.

> Ejemplo: que `/status` muestre cuánto lleva ejecutándose el trabajo activo.

## Contexto necesario

Lee antes de empezar:

- `CLAUDE.md` (raíz) — arquitectura y reglas.
- El `CLAUDE.md` del paquete que vayas a tocar.
- Los archivos que ya resuelven algo parecido.

Preguntas a responder antes de escribir código:

- ¿Es lógica pura? → `packages/shared`.
- ¿Necesita disco o procesos? → `apps/agent`.
- ¿Necesita hablar con Telegram o Supabase? → `apps/gateway`.
- ¿Cambia el contrato entre gateway y agente? → esquema Zod en `shared/schemas.ts`.
- ¿Cambia el esquema de BD? → migración **nueva**.

## Archivos probablemente afectados

| Tipo de cambio | Archivos |
|---|---|
| Comando de Telegram | `shared/telegram/commands.ts`, `gateway/handlers/commands.ts` |
| Formato de mensaje | `shared/telegram/format.ts` |
| Endpoint | `gateway/handlers/api.ts`, `gateway/index.ts`, `shared/schemas.ts` |
| Ejecución local | `agent/job-runner.ts`, `agent/agent.ts` |
| Proveedor | `agent/providers/` |
| Base de datos | `supabase/migrations/000N_*.sql` |

## Restricciones

- No elimines funcionalidad existente.
- Valida toda entrada externa con Zod.
- `spawn` con argumentos separados; nunca `exec` ni `shell`.
- No introduzcas secretos ni rutas absolutas personales.
- Si cambias el contrato gateway↔agente, mantén la compatibilidad: campo
  opcional o con valor por defecto.
- Si añades un valor a un enum de `constants.ts` que exista también en la BD,
  crea la migración que amplíe el enum de Postgres.

## Pruebas requeridas

- Camino feliz.
- Al menos dos casos límite (entrada vacía, valor fuera de rango).
- El caso de error, con el mensaje que verá el usuario.
- Si tocaste el contrato: prueba de que el esquema acepta y rechaza lo esperado.

Las pruebas **no** pueden consumir tokens reales.

## Verificación

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Si el cambio afecta al flujo de trabajos: `npm run demo`.

## Formato del informe final

```
Qué se ha implementado:
  <una o dos frases>

Archivos modificados:
  <lista con una línea de por qué cada uno>

Pruebas añadidas:
  <cuáles y qué cubren>

Comprobaciones ejecutadas:
  lint       OK / FALLO (salida)
  typecheck  OK / FALLO (salida)
  test       N pasan, M fallan
  build      OK / FALLO

Lo que NO he verificado:
  <sé explícito: qué queda sin probar y por qué>

Pendiente / limitaciones:
  <lo que requiere credenciales, decisión del usuario, o quedó fuera>
```
