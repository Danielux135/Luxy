# Aplicar el paquete de continuidad de Luxy

Este paquete sólo contiene documentación. No incluye TypeScript, SQL, secretos,
configuración, commit, push ni despliegue.

## 1. Abrir el worktree correcto

```powershell
$repository = Join-Path $env:USERPROFILE "AppData\Local\Luxy\worktrees\luxy-work-update-001"
Set-Location $repository
git status --short --branch
```

No continúes si la ruta es la carpeta original de Luxy en vez del worktree
aislado.

## 2. Extraer el ZIP

```powershell
$pack = Join-Path $env:USERPROFILE "Downloads\luxy-vscode-context-pack-2026-08-04.zip"
Expand-Archive -Path $pack -DestinationPath $repository -Force
```

Los únicos archivos existentes que actualiza son `AGENTS.md`, `CLAUDE.md`,
`README.md` y `docs/DESKTOP.md`. El resto de archivos canónicos se añade nuevo.

## 3. Revisar sin hacer commit

```powershell
git status --short --branch
git diff --stat
git diff -- AGENTS.md CLAUDE.md README.md docs/DESKTOP.md
```

No hagas commit ni push. Abre Claude o Codex y usa el prompt de `LA-005` en
`LOCAL-ACTIONS.md`.

## 4. Primera tarea

La IA debe leer los documentos y ejecutar `LA-002`. El ID activo es
`LUXY-P0-LONG-RESPONSES`; no debe implementar nada hasta registrar el estado
real del checkpoint como `P0.0`.
