# Desarrollo

## Estructura

```
packages/shared/   tipos, esquemas zod, catálogo de modelos y lógica PURA
apps/gateway/      Cloudflare Worker: la única pieza pública
apps/agent/        ejecutor local: worktrees, herramientas, proveedores
apps/desktop/      Electron: ventana, bandeja, IPC, secretos
supabase/migrations/  SQL acumulativo
```

**Regla estructural:** `packages/shared` no importa `node:*` ni tipos de Workers.
Lo consumen los cuatro lados, incluido el renderer de React. Si una función
necesita disco o red, va en `apps/`, no en shared.

## Comandos

```powershell
npm install
npm run check            # lint + typecheck + test + build. Esto es lo que hay que pasar.

npm run desktop:dev      # Electron con recarga
npm run desktop:build
npm run desktop:package  # instalador NSIS y portable
npm run desktop:test

npm run test:live        # contra la API real; se salta salvo que la pidas
npm run demo             # trabajo completo con un proveedor simulado
```

## Los tres proyectos TypeScript del escritorio

`apps/desktop` tiene tres `tsconfig` y no es por gusto: `main`, `preload` y
`renderer` tienen `lib`, `types` y `moduleResolution` incompatibles entre sí. El
renderer no puede ver los tipos de Node, y eso es deliberado.

Los tres están en las `references` de `tsconfig.build.json`, así que `npm run
typecheck` los cubre. Si añades otro, añádelo también ahí o quedará sin comprobar
en silencio.

## Formatos de compilación

| Salida | Formato | Por qué |
|---|---|---|
| main | ESM | coherente con el resto del monorepo |
| **preload** | **CJS** | con `sandbox: true` se ejecuta como JS plano, sin módulos |
| renderer | bundle de Vite | — |

**El preload no puede importar nada con dependencias.** Por eso las constantes de
canal viven en `src/shared/channels.ts`, separadas de los esquemas zod de
`ipc.ts`. Si las juntas, el preload falla con `module not found`, `window.luxy`
queda indefinido y la ventana sale en blanco — sin que lo detecte ni el
typecheck ni los tests.

## Pruebas

`npm test` **nunca** llama a una API real ni gasta tokens. Lo que sí se ejecuta de
verdad: git (worktrees en carpetas temporales), procesos hijo, symlinks y
junctions reales. Es intencionado: ahí es donde aparecen los fallos de Windows.

Las pruebas contra la API real están en `live.test.ts` y se saltan solas salvo que
pongas `LUXY_LIVE_TESTS=1`.

**Cuidado con los tests que se saltan solos.** Los de junction se saltan si no hay
permisos para crearlos, y entonces pasarían trivialmente. Si tocas esa zona,
comprueba aparte que la junction se crea de verdad en tu equipo.

## Añadir cosas

**Un modelo:** ver [MODELS.md](MODELS.md).

**Una herramienta del agente:**
1. Nombre en `AGENT_TOOL_NAMES` (`packages/shared/src/models/types.ts`).
2. Esquema zod en `TOOL_SCHEMAS` y descripción en `TOOL_DESCRIPTIONS`.
3. Método en `ToolExecutor` y caso en `dispatch`.
4. **Toda ruta pasa por `this.resolve()`.** Sin excepciones.
5. Tests de que no puede salir del worktree ni leer credenciales.

**Un canal IPC:**
1. Nombre en `channels.ts` (no en `ipc.ts`: lo carga el preload).
2. Esquema zod de argumentos en `ipc.ts`.
3. Handler en `handlers.ts` con `handle()`, que valida antes de tocar nada.
4. Método en el preload, y solo un verbo cerrado.

Hay un test que rechaza nombres de canal que suenen a verbo abierto (`exec`,
`run`, `eval`, `shell`…). Si salta, **renombra el canal**, no relajes el test.

## Al añadir una barrera de seguridad, busca el camino paralelo

La revisión de seguridad de este trabajo encontró cuatro fallos y tres eran el
mismo patrón: la barrera estaba puesta en un sitio y el camino paralelo seguía
abierto.

- El guardián de manifiestos estaba en el ejecutor, pero `job-runner` lanzaba las
  pruebas por su cuenta.
- El confinamiento estaba en `confinePath`, pero los recorridos de directorio
  usaban `join()` directamente.
- La validación de rutas estaba en `migration:deleteFile`, pero no en
  `migration:import`.

Cuando añadas una comprobación, busca quién más hace esa operación.

## Antes de decir que algo está terminado

Ejecuta `npm run check`. Y si el cambio afecta a la aplicación, **ábrela**: hay
fallos que compilan, pasan typecheck y pasan los tests, y aun así dejan la
ventana en blanco.

No digas «verificado» cuando solo está «implementado».
