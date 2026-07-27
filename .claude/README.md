# .claude/

Configuración de Claude Code para este repositorio. **Solo contiene ajustes
seguros y versionables**: no hay secretos ni rutas personales.

## settings.json

Define permisos para desarrollo local en este proyecto.

**Permitido**: leer y editar archivos del proyecto, `git status`, `git diff`,
`git log`, y los comandos de lint, typecheck, tests y build declarados en
`package.json`.

**Denegado explícitamente**:

| Categoría | Por qué |
|---|---|
| `git push`, cambiar remotos | publicar es siempre decisión del usuario |
| `rm -rf`, `git reset --hard`, `git clean -fdx` | borrados destructivos |
| `wrangler deploy`, `wrangler secret` | desplegar y tocar secretos |
| `supabase db push`, `psql` | migraciones remotas |
| `npm publish`, `npm run deploy` | publicaciones |
| `curl`, `wget`, `Invoke-WebRequest` | descargar y ejecutar scripts de Internet |
| `reg add`, `schtasks`, `Register-ScheduledTask` | cambios en el registro y autoarranque |
| Leer o escribir `.env`, `.env.providers`, `.dev.vars`, `wrangler.toml`, claves PEM y SSH | acceso a credenciales |

Estas denegaciones son coherentes con las reglas de `CLAUDE.md` y `AGENTS.md`.
El autoarranque y los despliegues solo los ejecuta el usuario, a mano.

## Compatibilidad

El formato de `permissions.allow` / `permissions.deny` es el de Claude Code 2.x.
Si tu versión no admite alguna propiedad, Claude Code la ignora; comprueba con:

```powershell
claude --version
claude doctor
```

No añadas propiedades inventadas: si necesitas una opción, verifica antes que
existe en la versión instalada.

## Qué NO poner aquí

- Secretos o tokens.
- Rutas absolutas de un ordenador concreto.
- Permisos globales para `git push`, despliegues o migraciones remotas.
- Configuración de MCP que apunte a servicios privados.

Los ajustes personales que no quieras versionar van en `.claude/settings.local.json`,
que está cubierto por `.gitignore` a través de la regla general de este repositorio.
