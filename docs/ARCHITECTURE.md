# Arquitectura de Luxy

## Visión general

```
┌──────────────────────────┐
│ Luxy Studio / Telegram   │
└────────────┬─────────────┘
             │ HTTPS autenticado / webhook
┌─────▼─────────────────────┐
│ Cloudflare Worker         │  pasarela pública
│  - API de Studio          │
│  - webhook y comandos     │
│  - API privada de máquinas│
└─────┬─────────────────────┘
      │ PostgREST (service_role)
┌─────▼─────────────────────┐
│ Supabase / PostgreSQL     │  estado compartido y cola
│  - jobs, leases           │
│  - eventos, aprobaciones  │
└─────▲─────────────────────┘
      │ polling HTTPS saliente
┌─────┴─────────────────────┐
│ Agente local (PC/portátil)│
│  - worktrees de git       │
│  - ejecuta proveedores    │
│  - ejecuta pruebas        │
└─────┬─────────────────────┘
      │ spawn
┌─────▼─────────────────────────────────┐
│ Claude Code · Codex CLI · APIs HTTP   │
└───────────────────────────────────────┘
```

## Por qué esta forma

**El agente local solo hace conexiones salientes.** No abre puertos, no
necesita IP pública, no hace falta tocar el router y no hay superficie de
ataque entrante. El precio es el polling, que a 2 s es imperceptible.

**El gateway es el único punto público.** Concentra toda la autenticación:
secret token del webhook, lista blanca de usuarios y chats, tokens de máquina.

**Supabase es la cola y la memoria.** Permite que el trabajo sobreviva a que se
apague un ordenador, y que dos máquinas coordinen sin hablar entre ellas.

## Estructura del monorepo

```
packages/shared/     tipos, esquemas Zod y lógica pura (sin E/S)
apps/gateway/        Cloudflare Worker
apps/agent/          ejecutor local
supabase/migrations/ SQL acumulativo
scripts/             PowerShell para Windows
docs/                esta documentación
```

`packages/shared` no importa `node:*` ni nada específico de Workers: lo usan los
dos lados. Por eso el parser de comandos, el router automático, la selección de
máquina y la redacción de secretos viven ahí y se prueban de forma aislada.

## Ciclo de vida de un trabajo

1. **Creación.** Studio usa el token de máquina y `created_via='studio'`, sin ids
   ficticios de Telegram. Telegram valida secret, usuario y chat y conserva la
   idempotencia por `update_id`.
2. **Elección de proveedor.** Si lo pediste explícitamente, se respeta.
   Si usaste `/auto`, decide el router determinista y te explica el motivo.
3. **Elección de máquina.**
   - Una sola online compatible → se elige sola.
   - Varias → gana tu máquina preferida.
   - Varias sin preferida → Telegram te pregunta con botones.
   - Ninguna → el trabajo queda en cola.
4. **Reclamación.** El agente llama a `luxy_claim_job`, que usa
   `FOR UPDATE SKIP LOCKED`. **Dos máquinas nunca obtienen el mismo trabajo.**
5. **Ejecución.** Se crea un worktree, se lanza el proveedor, se ejecutan las
   pruebas, se recoge el diff.
6. **Progreso.** El agente manda eventos persistidos; Studio consulta el historial
   real. Si el origen es Telegram, el gateway también edita su mensaje.
7. **Cierre.** `complete`, `fail` o `cancelled`. El agente guarda primero el
   resultado en `pending-outcomes.json` y lo reenvía hasta que el endpoint
   idempotente confirma que Supabase lo recibió.

## Leases y heartbeats

- **Heartbeat** cada 10 s. Sin heartbeat durante 45 s (configurable), la
  máquina se considera desconectada.
- **Lease** de 120 s sobre el trabajo reclamado, renovado al enviar eventos.
- Un cron cada minuto ejecuta `luxy_expire_leases`:
  - Trabajo `claimed` que **nunca empezó** → vuelve a la cola. Es seguro.
  - Trabajo que **ya empezó** → pasa a `interrupted`. **No se reasigna**,
    porque pudo dejar cambios sin guardar en su worktree. Decides tú.

Esta distinción es la regla más importante del diseño: preferimos que un
trabajo se quede parado a que dos máquinas pisen cambios locales.

## Aislamiento por worktree

Cada tarea que puede modificar archivos corre en:

```
%LOCALAPPDATA%\Luxy\worktrees\<idcorto>-<timestamp>
rama: luxy/<idcorto>-<slug>
```

Tu carpeta de trabajo **nunca se toca**. Los worktrees con cambios no se borran
sin que lo apruebes.

## Decisiones registradas

Ver [decisions/0001-luxy-architecture.md](decisions/0001-luxy-architecture.md).
