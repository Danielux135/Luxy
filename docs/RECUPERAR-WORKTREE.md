# Recuperar el worktree desde el ordenador antiguo

Contexto: la carpeta `Luxy` se copió tal cual a otro ordenador. La copia trajo
el repositorio y su `.git`, pero **no** trajo `%LOCALAPPDATA%\Luxy` ni
`%APPDATA%\Luxy`, que están fuera de la carpeta. Ahí vive el trabajo de
Conversaciones, memoria y feedback, que nunca se commiteó.

Este documento contiene el prompt que hay que pegar a una IA que se ejecute en
el **ordenador antiguo**. No borra nada, no ejecuta comandos de git que
escriban, y no toca el repositorio.

---

## Prompt para la IA del ordenador antiguo

```text
Trabajas en Windows. Necesito que recuperes trabajo sin commitear que quedó en
este ordenador, lo empaquetes y me digas dónde está el ZIP. Es una operación de
SOLO LECTURA.

Reglas estrictas, no negociables:
- No ejecutes ningún comando de git que escriba: nada de commit, push, add,
  stash, checkout, reset, clean, worktree prune, branch -d, merge ni rebase.
- No borres, muevas ni renombres nada.
- No ejecutes npm install ni ningún instalador.
- Si algo no aparece, dilo claramente en vez de suponer o inventar rutas.

PASO 1 — localizar el worktree.
Ejecuta en PowerShell:

  Get-ChildItem "$env:LOCALAPPDATA\Luxy\worktrees" -Directory -ErrorAction SilentlyContinue |
    Select-Object Name, LastWriteTime

Busco una carpeta llamada aproximadamente `luxy-work-update-001`. Si la carpeta
`$env:LOCALAPPDATA\Luxy\worktrees` no existe, búscala en todo el disco:

  Get-ChildItem C:\ -Directory -Recurse -Filter "luxy-work-update-001*" -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName

Dime la ruta exacta que encuentres. Llámala <WT> a partir de aquí.

PASO 2 — comprobar que es la carpeta correcta.
Ejecuta, sin modificar nada:

  git -C "<WT>" status --short --branch
  git -C "<WT>" log --oneline -5
  git -C "<WT>" diff --stat

Y comprueba que el código que busco está de verdad ahí:

  Get-ChildItem "<WT>\apps","<WT>\packages" -Recurse -Include *.ts,*.tsx -ErrorAction SilentlyContinue |
    Select-String -Pattern "conversation|LUXY_MEMORY" -List |
    Select-Object -ExpandProperty Path -Unique

Si esa última orden no devuelve ningún archivo, PARA y dímelo: es la carpeta
equivocada.

PASO 3 — empaquetar.
Copia el worktree a una carpeta temporal excluyendo `node_modules`, `dist`,
`.git` y `out`, y comprímelo. Ejecuta:

  $wt   = "<WT>"
  $tmp  = Join-Path $env:TEMP "luxy-recuperacion"
  $dest = Join-Path $tmp "luxy-work-update-001"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  robocopy $wt $dest /E /XD node_modules dist out .git .turbo /XF *.log /NFL /NDL /NJH /NJS
  $zip = Join-Path $env:USERPROFILE "Desktop\luxy-work-update-001.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Compress-Archive -Path $dest -DestinationPath $zip
  Get-Item $zip | Select-Object FullName, Length

`robocopy` devuelve códigos de salida distintos de 0 cuando todo ha ido bien
(1 = archivos copiados). No lo trates como un error.

PASO 4 — buscar también los parches sueltos.
Ejecuta:

  Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "*luxy*" -ErrorAction SilentlyContinue |
    Select-Object Name, Length, LastWriteTime

Si aparece algún archivo `.patch` o `.zip` con `luxy` en el nombre, cópialo
también al Escritorio y dime cuáles son.

PASO 5 — informe final.
Dime exactamente:
1. La ruta del worktree que encontraste, o que no existe.
2. La rama y el commit base que devolvió `git log --oneline -5`.
3. Cuántos archivos modificados y sin seguimiento salieron en `git status`.
4. La ruta y el tamaño del ZIP.
5. Los parches encontrados en Downloads, si los hay.

NO hagas nada más. En concreto: no intentes commitear ese trabajo «para no
perderlo», no lo subas a ningún sitio y no toques el repositorio original.
```

---

## Qué NO se copia con ese prompt, y por qué

`%APPDATA%\Luxy\config.json` contiene el **token de la máquina**. No se mete en
el ZIP y no se manda por chat ni por correo. En el ordenador nuevo es más limpio
volver a generar la configuración:

```powershell
npm run setup:machine
```

El perfil de pruebas `%LOCALAPPDATA%\Luxy\test-profiles\studio-001` tampoco hace
falta: se regenera solo.

## Al recibir el ZIP en este ordenador

1. Descomprimir **fuera** del repositorio, por ejemplo en
   `C:\Users\Daniel\Desktop\luxy-recuperado`.
2. Comprobar contra la rama que sí sobrevivió, sin tocar el árbol actual:

   ```powershell
   git -C "C:\Users\Daniel\Desktop\proyecto github\Luxy" diff --stat luxy/work-update-001-studio -- .
   ```

3. Registrar el resultado en `LOCAL-ACTIONS.md` (`LA-007`) y en
   `CHANGELOG-WORK.md` antes de integrar nada.
4. No borrar nada del ordenador antiguo hasta que la verificación pase aquí.
