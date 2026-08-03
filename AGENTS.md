# AGENTS.md — reglas para agentes en Luxy

Para Codex y cualquier agente compatible con `AGENTS.md`. Comparte los límites
esenciales con `CLAUDE.md`; si algo parece contradecirse, gana la versión más
restrictiva y avisa de la discrepancia.

## Estructura del repositorio

```
packages/shared/      logica pura compartida: tipos, Zod, parser de comandos,
                      router, seleccion de maquina, redaccion, rutas.
                      NO importa node:* ni tipos de Cloudflare.
apps/gateway/         Cloudflare Worker. Unica pieza publica.
apps/agent/           ejecutor local en Node para Windows.
apps/desktop/         Luxy Studio en Electron/React; secretos solo en el main.
supabase/migrations/  SQL acumulativo, numerado.
scripts/              PowerShell y .cmd para Windows.
docs/                 documentacion.
```

Dónde tocar según el cambio:

| Cambio                | Archivo                                                                              |
| --------------------- | ------------------------------------------------------------------------------------ |
| Comando de Telegram   | `packages/shared/src/telegram/commands.ts` + `apps/gateway/src/handlers/commands.ts` |
| Formato de mensajes   | `packages/shared/src/telegram/format.ts`                                             |
| Router automático     | `packages/shared/src/router.ts`                                                      |
| Elección de máquina   | `packages/shared/src/machines.ts`                                                    |
| Endpoint privado      | `apps/gateway/src/handlers/api.ts` + `apps/gateway/src/index.ts`                     |
| API de Studio         | `apps/gateway/src/handlers/studio.ts` + contratos de `packages/shared`               |
| Interfaz de trabajos  | `apps/desktop/src/renderer/pages/Studio.tsx`                                         |
| Proveedor de IA       | `apps/agent/src/providers/`                                                          |
| Worktrees y git       | `apps/agent/src/git.ts`                                                              |
| Ejecución de procesos | `apps/agent/src/process.ts`                                                          |
| Esquema de BD         | nueva migración en `supabase/migrations/`                                            |

## Comandos principales

```powershell
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm run check     # los cuatro anteriores
npm run demo      # end-to-end con mocks, sin consumir APIs
```

Nunca ejecutes `npx wrangler deploy` ni apliques migraciones sin que el usuario
lo pida explícitamente.

## Límites de seguridad

**Modelos de IA**

- Prohibida la API de Anthropic.
- Prohibida la API de OpenAI.
- Prohibidas `ANTHROPIC_API_KEY` y `OPENAI_API_KEY`.
- Prohibida cualquier automatización de navegador (Selenium, Playwright) y de
  las interfaces web de Claude o ChatGPT.
- Claude Code y Codex CLI se usan con la **sesión local** del ordenador.
- Prohibido `--dangerously-skip-permissions` y
  `--dangerously-bypass-approvals-and-sandbox`.

**Secretos**

- Ningún secreto real en el repositorio. Los `.example` llevan `PENDIENTE_...`.
- `SUPABASE_SERVICE_ROLE_KEY` solo existe como secret de Cloudflare.
- Toda salida (logs, eventos, Telegram) pasa por `redact()`.
- Nunca se hereda el entorno completo en un proceso hijo.

**Sistema de archivos**

- Rutas de proyecto absolutas, sin `..`.
- Toda escritura dentro del worktree activo.
- Comprobar enlaces simbólicos con `realpath` antes de aceptar una ruta.

## Reglas para modificar código

1. Lee el archivo antes de editarlo.
2. Respeta el estilo existente: comentarios en español, en minúscula, explicando
   el porqué; código e identificadores en inglés.
3. TypeScript estricto. Nada de `any` fuera de los mocks de tests.
4. Imports relativos con extensión `.js` (obligatorio con `NodeNext`).
5. `import type` para lo que solo se use como tipo.
6. Valida **toda** entrada externa con Zod.
7. No elimines funcionalidad existente al refactorizar.
8. Prefiere módulos pequeños y claros a archivos grandes y mixtos.

## Reglas para ejecutar comandos

- **Siempre `spawn` con ejecutable y lista de argumentos separados.**
- **Nunca `exec`, nunca `shell: true`** con contenido no confiable.
- Cada comando lleva directorio de trabajo, timeout y lista de variables permitidas.
- Los comandos de comprobación salen de `config.json` y además deben estar en
  `ALLOWED_TEST_EXECUTABLES`.
- Las comprobaciones en el host exigen `allowHostChecks: true`; por defecto se
  bloquean porque pueden cargar codigo modificado por el modelo.
- Cancelar significa matar el **árbol completo** de procesos
  (`taskkill /T /F` en Windows).
- No instales dependencias automáticamente si el comando puede ejecutar scripts
  no confiables.

## Pruebas obligatorias

Con cada cambio importante, añade o actualiza pruebas. Las pruebas **nunca**
consumen tokens reales: Telegram, Supabase, Claude, Codex y las APIs HTTP están
mockeados.

Antes de dar nada por terminado:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Los cuatro deben pasar.

## Política de worktrees

- Toda tarea que modifique archivos corre en un worktree aislado bajo
  `%LOCALAPPDATA%\Luxy\worktrees`, en una rama `luxy/<id>-<slug>`.
- **La carpeta de trabajo del usuario nunca se toca.**
- No se borra un worktree con cambios sin aprobación explícita.
- Cancelar **no borra cambios**: se informa de qué quedó modificado y dónde.
- Si el proyecto no es un repositorio git: solo lectura, y se explica cómo
  inicializarlo.

## Prohibido hacer automáticamente

`git push` · desplegar · publicar · migraciones destructivas · borrar
repositorios · modificar fuera de los proyectos autorizados · tocar
credenciales · descargar y ejecutar scripts de Internet · enviar correos o
mensajes en nombre del usuario.

**Commits:** solo tras aprobación explícita del usuario.
**Push:** dos confirmaciones **y** `allowPush: true` en la máquina (por defecto `false`).

En Studio, **Aplicar cambios** equivale a crear el commit en la rama aislada
tras confirmación. **Descartar trabajo** elimina el worktree tras confirmación.
Ninguna de las dos acciones mezcla la rama principal ni hace `push`.

## Archivos que no debes editar ni publicar

```
.env  .env.providers  wrangler.toml  .dev.vars
%APPDATA%\Luxy\config.json
supabase/migrations/*.sql  ya aplicadas  (crea una nueva)
```

No introduzcas rutas absolutas de un ordenador concreto en archivos versionados.

## Cuándo una tarea está terminada

Todo lo siguiente, sin excepciones:

- [ ] El código compila (`npm run build`).
- [ ] `npm run lint` sin errores.
- [ ] `npm run typecheck` sin errores.
- [ ] `npm test` en verde, **sin ocultar fallos**.
- [ ] Hay pruebas de lo nuevo.
- [ ] La documentación afectada está actualizada.
- [ ] No se han introducido secretos ni rutas personales.
- [ ] Lo que dices haber verificado, lo has ejecutado de verdad.

**No afirmes que algo funciona si solo lo has implementado.** Si no lo
ejecutaste, dilo. Si una prueba falla, muéstrala.

## Mantener este archivo

Actualiza `AGENTS.md` **y** `CLAUDE.md` cuando cambie la arquitectura, los
comandos principales, la estructura del monorepo, las políticas de seguridad, el
flujo de despliegue, la configuración de proveedores o el sistema de trabajos y
permisos. Los dos archivos no deben contradecirse.
