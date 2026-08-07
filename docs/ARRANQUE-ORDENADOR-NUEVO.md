# Arranque en un ordenador nuevo

Cómo pasar de «acabo de clonar el repositorio» a «Luxy funciona» en una máquina
Windows vacía.

Esto **no** es `INSTALLATION.md`. Aquel documento instala el `.exe` para usar
Luxy; éste levanta el entorno completo para seguir desarrollándolo, incluido lo
que el repositorio no puede contener.

## Lo primero: el repositorio no basta

Clonar deja el código, la documentación y las migraciones. Deja fuera, **a
propósito**, cuatro cosas sin las cuales nada arranca:

| Qué falta                | Dónde vive                                    | Por qué no está aquí                                                                 |
| ------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| Claves de las APIs       | `.env.providers`, o cifradas en `secrets.enc` | Son secretos                                                                         |
| Entorno del gateway      | `apps/gateway/.dev.vars`                      | Contiene el `service_role` de Supabase                                               |
| Configuración de máquina | `%APPDATA%\Luxy\config.json`                  | Contiene el token de esta máquina, y las rutas de proyecto cambian en cada ordenador |
| `wrangler.toml`          | `apps/gateway/`                               | Lleva identificadores de cuenta                                                      |

De los cuatro hay `.example` versionado. **Ninguno se recupera del repositorio:
o los tienes anotados, o se regeneran.** El token de máquina se regenera solo,
las claves de API no.

Copiar un `config.json` de otro ordenador **no** sirve: las rutas de proyecto
son distintas y el token identifica a una máquina concreta.

## Requisitos

- Windows 10/11.
- Node ≥ 20.19 y npm.
- git.
- Claude Code y Codex CLI, **autenticados con la sesión local**. No llevan clave
  de API y Luxy no la pide. Sin autenticar, esos dos proveedores aparecen como
  no encontrados; el resto sigue funcionando.

Comprobación rápida:

```powershell
node --version; npm --version; git --version; claude --version; codex --version
```

## Orden exacto

El orden importa: cada paso depende del anterior y saltarse uno produce un error
que no señala su causa real.

### 1. Clonar e instalar

```powershell
git clone https://github.com/Danielux135/Luxy.git
cd Luxy
npm install
npm run build
```

`npm run build` **no es opcional**: los workspaces se enlazan por junctions y
vitest resuelve `@luxy/shared` contra `dist/`, no contra `src/`. Sin compilar,
las pruebas fallan con errores de importación que parecen otra cosa.

Verificación:

```powershell
npm run check
```

Debe terminar en verde. La cifra de referencia está en `TEST-RESULTS.md`. Esto
funciona **sin ningún secreto**: las pruebas nunca llaman a una API real.

### 2. Supabase

Ver `SUPABASE.md`. Hace falta un proyecto y aplicar `supabase/migrations/` en
orden numérico. Apunta la URL (`https://<ref>.supabase.co`) y la clave
`service_role`.

**Nunca modifiques una migración ya aplicada.** Si algo cambia, se añade una
nueva con el siguiente número.

### 3. Gateway

```powershell
cd apps/gateway
copy wrangler.toml.example wrangler.toml
copy .dev.vars.example .dev.vars
```

Rellena los siete valores obligatorios de `.dev.vars`; el archivo explica cada
uno. `MACHINE_REGISTRATION_SECRET` lo eliges tú:

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Despliega según `CLOUDFLARE.md`. En producción los secretos van con
`wrangler secret put`, no en el `.toml`.

Comprueba que responde antes de seguir. Si no responde, el paso 4 falla sin
decir por qué.

### 4. Configurar esta máquina

```powershell
npm run setup:machine
```

Pide nombre de máquina, URL del gateway y el secreto de registro. Escribe
`%APPDATA%\Luxy\config.json` con el token que devuelve el gateway. El secreto de
registro se usa una vez y se descarta.

**Aviso:** el asistente rechaza cualquier URL que no empiece por `https://`, y
`wrangler dev` sirve en `http://localhost:8787`. Para trabajar contra un gateway
local hay que escribir `config.json` a mano o usar un túnel.

### 5. Claves de las APIs

Una sola conexión compatible con OpenAI sirve varios modelos: no hay una clave
por familia. Ver `PROVIDERS.md` y `MODELS.md`.

Con Studio, el asistente las cifra en `secrets.enc`. Sin Studio, copia
`.env.providers.example` a `.env.providers` y rellénalo; Studio ofrecerá
importarlo y cifrarlo más adelante.

### 6. Arrancar

```powershell
npm start                    # agente por consola
npm run desktop              # Luxy Studio
npm run demo                 # trabajo completo con mocks, sin gastar tokens
```

`npm run demo` es la mejor comprobación de que la cadena entera funciona: no
necesita claves ni gasta nada.

## Lo aprendido el 2026-08-07 retirando el portátil

Esta sección son fallos reales, no hipótesis. Cada uno costó tiempo.

### Lo que hay ya montado y NO hay que rehacer

- **El gateway está desplegado** en Cloudflare (`luxy-gateway`, cuenta de
  Daniel). Un ordenador nuevo **no** necesita `wrangler dev` ni desplegar nada:
  apunta ahí y listo.
- **Los datos viven en Supabase**, proyecto `luxy-studio-test`. Trabajos,
  conversaciones, memoria y aprobaciones sobreviven al ordenador.

### Lo que el repositorio no puede darte, y hay que traer aparte

| Qué                           | Dónde estaba                 | Se puede regenerar                                                                                                    |
| ----------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Clave de la API china         | fuera del repositorio        | no: hay que tenerla apuntada                                                                                          |
| `MACHINE_REGISTRATION_SECRET` | secreto del Worker           | sí: se pone uno nuevo con `wrangler secret put`                                                                       |
| Token de máquina              | `%APPDATA%\Luxy\config.json` | sí: registrando la máquina otra vez                                                                                   |
| Secretos cifrados             | `%APPDATA%\Luxy\secrets.enc` | **no son portables**: van cifrados contra la cuenta de Windows de ese equipo. En otro PC se vuelven a escribir a mano |
| Rutas de los proyectos        | `config.json`                | sí, pero hay que saber dónde está cada proyecto en el equipo nuevo                                                    |

### Trampas concretas

1. **Una Luxy instalada no lee el repositorio.** Si abres el `.exe` de
   `%LOCALAPPDATA%\Programs\Luxy`, ejecuta el código con el que se empaquetó, no
   el que acabas de compilar. Para probar cambios: `npm.cmd run desktop:dev`.
2. **En PowerShell hay que usar `npm.cmd`**, no `npm`: la política de ejecución
   bloquea `npm.ps1`.
3. **Dos proyectos de Supabase se parecen mucho.** El Worker apuntaba a uno
   viejo y el SQL Editor a otro; el síntoma era `column jobs.created_via does
not exist` con esa columna existiendo. Si algo así vuelve a pasar, el log del
   Worker trae `supabaseHost`: mira contra cuál habla de verdad.
4. **Al cambiar de proyecto de Supabase, los tokens de máquina no viajan.**
   Cada máquina hay que registrarla otra vez.
5. **Los worktrees de `%LOCALAPPDATA%\Luxy\worktrees` no se clonan.** Antes de
   retirar un equipo, comprueba si alguno tiene trabajo sin commitear:

   ```powershell
   Get-ChildItem "$env:LOCALAPPDATA\Luxy\worktrees" -Directory | ForEach-Object {
       $n = (git -C $_.FullName status --porcelain 2>$null | Measure-Object).Count
       if ($n -gt 0) { "$($_.Name): $n archivos sin guardar" }
   }
   ```

   Así apareció la fase 4d de Luxy Remote, 1.047 líneas que no estaban en ningún
   commit.

6. **Los artefactos también son locales.** Viven en
   `%LOCALAPPDATA%\Luxy\artifacts` y no se sincronizan: en la base de datos sólo
   está la referencia.

## Comprobar dónde se rompió

La cadena es: **gateway → registro → `config.json` → agente → Studio**. Se rompe
por delante, y el síntoma aparece por detrás.

| Síntoma                        | Causa habitual                                                     |
| ------------------------------ | ------------------------------------------------------------------ |
| El worker no arranca           | Falta un valor en `.dev.vars`; `envSchema` los exige todos         |
| `setup:machine` falla          | El gateway no responde, o la URL no es `https://`                  |
| El agente no recoge trabajos   | No hay `config.json`, o el token no vale                           |
| Studio no ve máquinas          | El agente no manda heartbeat: sin él, 45 s y se marca desconectada |
| Las pruebas fallan al importar | Falta `npm run build`                                              |

Más casos en `TROUBLESHOOTING.md`.

## Para la IA que reciba este repositorio

Si eres un agente y te piden continuar el trabajo aquí, esto es lo que necesitas
saber antes de tocar nada.

**Lee primero, en este orden:** `PROJECT-STATE.md`, `CURRENT-TASK.md`,
`MASTER-PLAN.md`, `DECISIONS.md`, `CHANGELOG-WORK.md`, `TEST-RESULTS.md`,
`LOCAL-ACTIONS.md`, `AI-WORK-PROTOCOL.md`. Después `CLAUDE.md` (o `AGENTS.md`,
son equivalentes y no deben contradecirse).

Esos archivos son la memoria del proyecto, no un resumen decorativo. Contienen
auditorías ya hechas: **no las repitas**. Si el repositorio contradice la
documentación, para, registra la discrepancia y actualiza `PROJECT-STATE.md`
antes de editar.

**Lo que se espera de ti:**

- Cada paso del plan tiene un ID (`P0.5`, `F0.5`…). Cuando uno empieza, se
  bloquea o se cierra, actualiza `CURRENT-TASK.md` y añade evidencia real a
  `CHANGELOG-WORK.md` **en ese momento**, no al final.
- Antes de decir que algo está hecho: `npm run lint`, `npm run typecheck`,
  `npm test` y `npm run build`. Con su salida.
- No ocultes una prueba que falla. No digas «verificado» de algo que sólo está
  implementado: si no lo has ejecutado, dilo.
- Nunca limpies el worktree para que encaje con el plan. Sólo una IA escribe
  aquí a la vez; conserva lo que encuentres.
- Comentarios, documentación y mensajes de commit en **español**. Código e
  identificadores en inglés.

**Lo que no debes hacer nunca:**

- Usar la API de Anthropic o de OpenAI, ni `ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY`. Claude Code y Codex van con la sesión local.
- Automatizar las webs de Claude o ChatGPT.
- `--dangerously-skip-permissions`, ni su equivalente en Codex.
- `child_process.exec` o `shell: true` con contenido no confiable. Siempre
  `spawn`, con ejecutable y argumentos separados.
- Escribir un secreto o una ruta absoluta de alguien en un archivo versionado.
- `git push`, desplegar, o aplicar migraciones contra producción sin
  autorización explícita de Daniel, cada vez.

**Lo que puedes hacer sin ningún secreto:** leer, entender, editar, y ejecutar
las pruebas enteras. La suite no llama a ninguna API y no gasta tokens. Que
falten las claves **no** te impide trabajar en el código; sólo te impide ver la
interfaz en marcha. Si ese es el caso, dilo al informar en vez de dar por
verificado lo que no has visto.
