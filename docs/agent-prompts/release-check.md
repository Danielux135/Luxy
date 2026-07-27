# Plantilla: comprobación previa a una entrega

## Objetivo

Verificar que el repositorio está en un estado entregable. **Comprobar, no
arreglar.** Si encuentras algo roto, infórmalo; el usuario decide.

## Contexto necesario

- `CLAUDE.md` y `AGENTS.md` — reglas que deben seguir vigentes.
- `docs/SECURITY.md` — garantías declaradas.

## 1. Comprobaciones automáticas

Ejecútalas **todas**, en este orden, y guarda la salida real:

```powershell
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm run demo
```

Y el empaquetado del Worker, sin desplegar:

```powershell
cd apps\gateway
npm run dry-run
cd ..\..
```

Y la sintaxis de los scripts de PowerShell:

```powershell
Get-ChildItem scripts\*.ps1 | ForEach-Object {
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$null, [ref]$errors)
  if ($errors.Count -eq 0) { "OK    $($_.Name)" } else { "FALLO $($_.Name)"; $errors }
}
```

## 2. Secretos y datos personales

```powershell
# secretos con forma reconocible
Select-String -Path "**/*.ts","**/*.js","**/*.json","**/*.sql","**/*.md","**/*.ps1" `
  -Pattern "eyJ[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|\d{8,}:[A-Za-z0-9_-]{30,}"

# rutas personales versionadas
git ls-files | ForEach-Object { Select-String -Path $_ -Pattern "C:\\\\Users\\\\" -ErrorAction SilentlyContinue }

# archivos que nunca deben estar en git
git ls-files | Select-String -Pattern "^\.env$|^\.env\.providers$|wrangler\.toml$|\.dev\.vars$|config\.json$"
```

Los tres deben salir vacíos (salvo los `.example`, que llevan `PENDIENTE_...`).

## 3. Coherencia de la documentación

- [ ] Los comandos citados en `CLAUDE.md` existen en `package.json`.
- [ ] Los comandos citados en `AGENTS.md` existen en `package.json`.
- [ ] `CLAUDE.md` y `AGENTS.md` no se contradicen.
- [ ] El `README.md` describe la implementación real, no la deseada.
- [ ] `.claude/settings.json` no autoriza `git push`, despliegues, migraciones
      remotas, borrados recursivos ni acceso a credenciales.
- [ ] Las rutas de archivos citadas en la documentación existen.

`npm test` cubre parte de esto (`docs.test.ts`).

## 4. Reglas del proyecto

```powershell
# no debe haber ejecucion por shell
Select-String -Path "apps/**/*.ts","packages/**/*.ts" -Pattern "exec\(|execSync|shell:\s*true"

# no deben usarse las APIs prohibidas
Select-String -Path "apps/**/*.ts","packages/**/*.ts" -Pattern "ANTHROPIC_API_KEY|OPENAI_API_KEY|dangerously-skip-permissions"
```

Ambos deben salir vacíos, salvo comentarios que expliquen la prohibición.

## 5. Estado de git

```powershell
git status
git log --oneline -10
```

- [ ] No hay cambios sin querer.
- [ ] **No se ha hecho push.**
- [ ] Los mensajes de commit están en español y sin firmas de agente.

## Restricciones

- **No arregles nada durante la comprobación**, salvo que el usuario lo pida.
- **No hagas `git push`.** Nunca, en ninguna circunstancia.
- **No despliegues** el Worker ni apliques migraciones.
- **No ocultes un fallo.** Si algo falla, pega su salida.

## Formato del informe final

```
COMPROBACIONES AUTOMÁTICAS
  npm run lint       OK / FALLO
  npm run typecheck  OK / FALLO
  npm test           N pasan, M fallan
  npm run build      OK / FALLO
  npm run demo       OK / FALLO
  wrangler dry-run   OK / FALLO
  scripts .ps1       OK / FALLO

  <pega la salida real de lo que haya fallado>

SECRETOS Y DATOS PERSONALES
  <resultado de las tres búsquedas>

COHERENCIA DE LA DOCUMENTACIÓN
  <lista de comprobación con su estado>

REGLAS DEL PROYECTO
  <resultado de las búsquedas>

ESTADO DE GIT
  <rama, cambios pendientes, si se ha hecho push (no debería)>

VEREDICTO
  <entregable | no entregable, con el motivo concreto>

LO QUE NO HE PODIDO COMPROBAR
  <sé explícito: p. ej. las migraciones contra Postgres real>
```
