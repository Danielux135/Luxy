# Instalación

Luxy tiene dos partes: el **gateway** (Cloudflare Worker + Supabase, se despliega
una vez) y **Luxy Desktop** (en cada ordenador que quieras usar).

Esta guía cubre Desktop. Para el gateway, ver `CLOUDFLARE.md` y `SUPABASE.md`.

## Sin consola

El uso normal no necesita PowerShell. Instalas, abres y configuras desde la
interfaz.

## 1. Instalar

Ejecuta `Luxy Setup 0.1.0.exe`. Es por usuario: **no pide permisos de
administrador**.

Existe también `Luxy-portable-0.1.0.exe` para probar sin instalar, pero **sin
notificaciones**: Windows solo las entrega a aplicaciones con acceso directo en el
Menú Inicio.

## 2. Configuración inicial

Al abrir Luxy por primera vez arranca un asistente de seis pasos.

### Paso 1 — Máquina

- **Nombre**: minúsculas, dígitos y guion. Por ejemplo `sobremesa`.
- **URL del gateway**: la de tu Worker. El botón *Comprobar* verifica que responde.
- **Secreto de registro**: el `MACHINE_REGISTRATION_SECRET` de tu gateway.

El secreto de registro **se usa una vez y se descarta**: no se guarda en ningún
sitio. El token que devuelve el gateway sí se guarda, cifrado.

### Paso 2 — Herramientas locales

Luxy detecta git, Node, npm, Claude Code, Codex CLI y Flutter, y muestra versión y
ruta de cada una.

**Claude y Codex usan tu sesión local.** No hacen falta claves de API para ellos.
Si aparecen como no encontrados, autentícalos en tu terminal.

### Paso 3 — Conexión de API

Un endpoint compatible con OpenAI que sirve varios modelos.

La clave **se cifra al guardarla** con tu cuenta de Windows y no vuelve a
mostrarse. Para cambiarla se introduce una nueva.

Si Luxy encuentra claves en texto plano de una instalación anterior
(`.env.providers`), te ofrece importarlas, cifrarlas y borrar el archivo original.
**No lo borra sin confirmar antes que la clave quedó guardada.**

### Paso 4 — Modelos

El catálogo se registra completo. Verás cuáles sirve tu conexión de verdad.
Puedes activar, desactivar y cambiar el predeterminado de cada familia después,
sin repetir el asistente.

### Paso 5 — Proyectos

Añade carpetas con el selector nativo. El alias es lo que escribirás en Telegram.

Cada proyecto tiene sus permisos: leer, editar, commit y push. **El push está
desactivado por defecto** y además exige doble confirmación.

Un proyecto que permita edición sin Git se prepara automáticamente en el primer
trabajo: Luxy crea un `.gitignore` y el commit local `estado inicial`, sin
remoto, antes de crear el worktree aislado. Un proyecto con `allowEdits: false`
continúa siendo sólo de lectura.

### Paso 6 — Resumen

Revisa y termina. El agente arranca solo.

## 3. Uso diario

- Luxy se queda en la **bandeja del sistema**. Cerrar la ventana la oculta.
- Solo **«Salir completamente»** termina el agente.
- Desde Telegram: `/deepseek mi-proyecto arregla los tests`.

Para que arranque con Windows, actívalo en Ajustes.

## Dónde vive todo

| Qué | Dónde |
|---|---|
| Configuración (sin secretos) | `%APPDATA%\Luxy\config.json` |
| Secretos cifrados | `%APPDATA%\Luxy\secrets.enc` |
| Registros y worktrees | `%LOCALAPPDATA%\Luxy\` |

**Al desinstalar no se borra nada de esto.**

## Instalar desde el código

```powershell
git clone <repo>
cd Luxy
npm install
npm run desktop:package
```

Requiere Node ≥ 20.19. Los artefactos quedan en `apps/desktop/release/`.

El primer `npm install` descarga los binarios de Electron (~150 MB). Si tu npm
tiene activada una política `allowScripts`, tendrás que aprobar ese paquete:

```powershell
npm approve-scripts electron
```

## La CLI

Sigue existiendo como herramienta avanzada y de recuperación:

```powershell
npm start
```

Ten en cuenta que **no puede leer `secrets.enc`** (es Node puro, sin acceso a
`safeStorage`). Ver `TROUBLESHOOTING.md`.
