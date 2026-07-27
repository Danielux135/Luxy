# Instalación en Windows

Este documento separa la instalación **en el PC de casa** y **en el portátil**,
porque son instalaciones independientes que comparten el mismo gateway.

> **Importante:** Claude Code y Codex CLI guardan la sesión **localmente**.
> Autenticarte en el PC **no** te autentica en el portátil. Hay que hacerlo
> una vez en cada ordenador.

---

## Comprobaciones comunes

En **ambos** equipos, antes de nada:

```powershell
node --version
npm --version
git --version
claude --version
claude doctor
codex --version
```

Resultado esperado:

- `node` v20 o superior.
- `npm` presente.
- `git` presente.
- `claude` devuelve una versión y `claude doctor` no reporta problemas graves.
- `codex` devuelve una versión.

Si falta alguno:

```powershell
# Node.js: descarga desde https://nodejs.org (LTS)
# Git:     descarga desde https://git-scm.com/download/win

npm install -g @anthropic-ai/claude-code
npm install -g @openai/codex
```

---

# Instalación en PC de casa

### 1. Clona el proyecto

```powershell
cd "C:\Users\Daniel\Desktop\proyecto github"
cd Luxy
npm install
npm run build
```

### 2. Comprueba que funciona sin tocar nada externo

```powershell
npm test
npm run demo
```

`npm run demo` monta un repositorio temporal, ejecuta un proveedor simulado,
lanza las pruebas y recoge el diff. **No consume ninguna API.**

### 3. Inicia sesión en Claude Code

```powershell
claude
```

Sigue el flujo de login con tu suscripción. Sal con `/exit`.

```powershell
claude doctor
```

### 4. Inicia sesión en Codex

```powershell
codex
```

Sigue el flujo con tu cuenta de ChatGPT.

### 5. Claves de las APIs HTTP (opcional)

```powershell
Copy-Item .env.providers.example .env.providers
notepad .env.providers
```

Sáltate este paso si solo vas a usar Claude Code y Codex.

### 6. Configura la máquina

```powershell
npm run setup:machine
```

Responde:

| Pregunta | Ejemplo en el PC |
|---|---|
| Nombre de esta máquina | `casa` |
| URL del gateway | `https://luxy-gateway.TU-CUENTA.workers.dev` |
| Secreto de registro | el valor de `MACHINE_REGISTRATION_SECRET` |
| Alias del proyecto | `errorlux` |
| Ruta de `errorlux` | `C:\Users\Daniel\Desktop\proyecto github\Errorlux` |
| Tipo | `flutter` |
| Comandos | acepta los sugeridos (`flutter analyze`, `flutter test`) |
| Alias del proyecto | `portfolio` |
| Ruta de `portfolio` | `C:\Users\Daniel\Desktop\proyecto github\portfolio` |
| Tipo | `node` |
| Permitir push | **no** (recomendado) |

Al terminar guarda `%APPDATA%\Luxy\config.json`.

### 7. Arranca

```powershell
.\scripts\start-luxy.ps1
```

O doble clic en `scripts\start-luxy.cmd`.

### 8. Comprueba desde el móvil

```
/machines
```

Debe aparecer `casa: conectada`.

---

# Instalación en portátil

Exactamente lo mismo, con **dos diferencias**: el nombre de la máquina y las
rutas de los proyectos.

### 1. Clona el proyecto

```powershell
cd "C:\Users\Daniel\Documents\GitHub"
git clone <url-del-repo> Luxy
cd Luxy
npm install
npm run build
npm test
```

### 2. Inicia sesión otra vez

**Esto es obligatorio.** Las sesiones son locales al ordenador:

```powershell
claude
claude doctor
codex
```

### 3. Configura la máquina con SUS rutas

```powershell
npm run setup:machine
```

| Pregunta | Ejemplo en el portátil |
|---|---|
| Nombre de esta máquina | `portatil` |
| URL del gateway | **la misma** que en el PC |
| Secreto de registro | **el mismo** que en el PC |
| Alias del proyecto | `errorlux` (**el mismo alias**) |
| Ruta de `errorlux` | `C:\Users\Daniel\Documents\GitHub\Errorlux` (**ruta distinta**) |

El alias es el mismo para que `/claude errorlux ...` funcione desde los dos.
La ruta es distinta porque cada ordenador tiene el proyecto en otro sitio.

### 4. Arranca

```powershell
.\scripts\start-luxy.ps1
```

### 5. Comprueba

```
/machines
```

Ahora deberías ver ambas. Elige cuál usar:

```
/use portatil
```

---

## Uso con las dos máquinas

- Si solo hay **una** encendida, Luxy la usa sin preguntar.
- Si hay **dos**, usa tu preferida (`/use`).
- Si hay dos y no has fijado preferida, Telegram te muestra botones.
- Si **ninguna** está encendida, el trabajo queda en cola y se ejecuta en cuanto
  arranques una.

Dos máquinas **nunca** ejecutan el mismo trabajo: lo garantiza
`FOR UPDATE SKIP LOCKED` en Postgres.

---

## Autoarranque (opcional)

**No se activa durante la instalación.** Solo si lo pides:

```powershell
# PC de sobremesa: siempre enchufado
.\scripts\install-autostart.ps1

# Portátil: solo con corriente (por defecto), para no gastar batería
.\scripts\install-autostart.ps1

# Portátil, si quieres que también funcione con batería
.\scripts\install-autostart.ps1 -OnBattery
```

Quitarlo:

```powershell
.\scripts\uninstall-autostart.ps1
```

---

## Actualizar los dos equipos

En cada uno:

```powershell
git pull
npm install
npm run build
npm test
```

La configuración local (`%APPDATA%\Luxy\config.json`) **no se toca** al
actualizar: no está en el repositorio.

---

## Problemas frecuentes en Windows

**`start-luxy.ps1` no se ejecuta: "no se puede cargar el archivo"**

```powershell
Get-ExecutionPolicy -Scope CurrentUser
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

O usa `scripts\start-luxy.cmd`, que no depende de la política.

**`spawn npm ENOENT` o `EINVAL`**

Ya está resuelto: Luxy desreferencia los shims `.cmd` de Windows. Si lo ves,
comprueba que `where.exe npm` devuelve algo y reporta el caso.

**Antivirus bloquea `taskkill`**

Luxy usa `taskkill /T /F` para cancelar el árbol de procesos. Si tu antivirus
lo bloquea, la cancelación puede dejar procesos huérfanos.

**Las rutas con espacios**

Funcionan. `C:\Users\Daniel\Desktop\proyecto github\Errorlux` es válida: nunca
se construye una línea de comandos concatenando texto.
