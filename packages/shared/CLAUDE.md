# packages/shared — reglas específicas

Lógica **pura** compartida entre el Worker y el agente local.

## Regla estructural

**Este paquete no puede importar `node:*` ni tipos de Cloudflare Workers.**

Lo consumen los dos lados, que corren en entornos distintos:
- El Worker no tiene `fs`, `Buffer` ni `process`.
- El agente no tiene las APIs específicas de Workers.

Solo se permite lo que existe en ambos: `fetch`, `crypto.getRandomValues`,
`URL`, `TextEncoder`, y JavaScript estándar.

Si una función necesita disco o red, **no va aquí**. Va en `apps/agent` o
`apps/gateway`.

## Qué vive aquí

| Archivo | Contenido |
|---|---|
| `constants.ts` | valores compartidos; los enums nacen aquí |
| `types.ts` | tipos de dominio e interfaces de proveedor |
| `schemas.ts` | **todos** los esquemas Zod |
| `redact.ts` | redacción de secretos y entorno seguro |
| `paths.ts` | validación de rutas sin tocar disco |
| `machines.ts` | selección de máquina, leases |
| `router.ts` | router automático determinista |
| `budget.ts` | presupuesto diario de proveedores |
| `backoff.ts` | reintentos con jitter |
| `telegram/commands.ts` | parser de comandos y menciones |
| `telegram/format.ts` | tarjetas y división de mensajes |

## Por qué la lógica difícil vive aquí

Todo lo que es puro se puede probar sin mocks, sin red y sin disco. Por eso el
parser de comandos, la elección de máquina, el router y la redacción están aquí:
son las partes con más casos límite y las que más pruebas necesitan.

**Si te cuesta probar algo, probablemente le sobra E/S.** Sepárala.

## Determinismo

Las funciones de este paquete deben ser deterministas y aceptar sus
dependencias temporales por parámetro:

```ts
export function isMachineOnline(machine, now: Date = new Date(), ...) 
export function computeBackoffDelay(attempt, options, random = Math.random)
export function checkBudget(state, providerId, dailyBudget, now = new Date())
```

Así las pruebas fijan el tiempo y el azar sin `vi.mock`.

**Excepción justificada:** `generateShortId` usa `crypto.getRandomValues`, que
existe en ambos entornos.

## Los esquemas Zod son el contrato

`schemas.ts` define el contrato entre el gateway y el agente. Si cambias uno:

1. Comprueba los dos lados: quien lo produce y quien lo consume.
2. Si el cambio rompe compatibilidad, un agente antiguo dejará de funcionar
   contra un gateway nuevo. Haz el campo opcional o dale valor por defecto.
3. Los tipos se derivan con `z.infer`, no se escriben a mano.

## Añadir una constante enumerada

Si añades un valor a `JOB_STATUSES`, `PROVIDER_IDS` o `JOB_EVENT_TYPES`:

1. Añádelo aquí.
2. Actualiza su etiqueta en `telegram/format.ts` (`STATUS_LABELS`,
   `PROVIDER_LABELS`): TypeScript te obligará, porque son `Record` completos.
3. Si afecta a la base de datos, crea una **migración nueva** que amplíe el enum
   correspondiente. Los dos deben coincidir.

## Pruebas

Todo lo de este paquete se prueba sin mocks. Es el paquete con más cobertura y
debe seguir siéndolo. Cada rama del router, cada caso de selección de máquina y
cada patrón de redacción tienen su prueba.
