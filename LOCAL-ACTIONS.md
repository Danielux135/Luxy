# Luxy — acciones locales de Daniel

## LA-035 — publicar la consolidacion de ramas

Estado: `pending` — abierta el 2026-09-02.

En local ya solo existe `main`, con todo el trabajo dentro. El remoto no se ha
tocado porque exige `push` y eso necesita tu autorizacion explicita. Cuando la
des, en este orden:

1. `git push origin main` — publica los 48 commits. Va primero: hasta que este
   hecho, `origin` es la unica copia de las ramas viejas y borrarlas antes
   dejaria el trabajo solo en este ordenador.
2. `git push origin --delete feat/luxy-desktop luxy/work-update-001-studio
   luxy/auto-init-git luxy/phase-4d-session-host luxy/f9-1-vault-crypto`
3. `git remote prune origin`


## LA-034 — validar F9.29 con el personaje real

Estado: `pending` — abierta el 2026-09-02.

La compilación está hecha y las pruebas demuestran el prompt que se envía, pero
ninguna prueba automática puede demostrar que un modelo concreto mantendrá el
rol. Reinicia Luxy Studio/Agent con este worktree y repite el caso que fallaba:

1. abre la conversación del personaje y confirma que sigue seleccionado;
2. establece un hecho visible de la escena (por ejemplo, qué lleva puesto en su
   foto) y comprueba que la respuesta no inventa otra apariencia para negarlo;
3. pide «envíame otra vez tu foto de perfil»: debe responder en personaje y
   reenviar el medio existente. Este paso **no gasta una generación**;
4. sólo si quieres probar la rama de pago, pide una imagen nueva y confirma que
   aparece. Eso sí consume créditos de Xavira.

Si el proveedor elegido mantiene una política propia incompatible con el rol,
anota proveedor y modelo exactos y repite con una conexión `chat completions`
adecuada: F9.29 elimina las contradicciones de Luxy, no puede cambiar las reglas
internas de un modelo externo.

## LA-033 — probar la bóveda con dos equipos y dos cuentas

Estado: `pending` — abierta el 2026-09-02.

Es lo único de seguridad del bloque `F9` que **no se puede dar por verificado**.
Todo lo demás ya se ejecutó contra los servicios reales (`LA-031`), pero estas
dos cosas necesitan una segunda máquina y una segunda cuenta:

1. **Que un usuario no lea los registros de otro.** `withVaultAuth` filtra por
   el usuario de la sesión y las pruebas lo cubren con dobles, pero eso sólo se
   confirma con Postgres delante. Registra una segunda cuenta, crea contenido en
   las dos y comprueba que sincronizar desde una **no trae nada** de la otra.

2. **La sincronización entre dos equipos.** Entrar en el segundo ordenador con
   sólo el correo y la contraseña, sincronizar, y verificar que las
   conversaciones y las imágenes aparecen y **se descifran**. Mira también el
   recuento de medios: el texto y los archivos se cuentan por separado.

Lo que ya se sabe y conviene no confundir con un fallo:

- **los personajes no se sincronizan**: son locales. En el segundo equipo habrá
  que darlos de alta a mano, y la API del proveedor no sabe listarlos;
- **un archivo de más de 90 MB no viaja**: se salta, se cuenta y la interfaz lo
  dice;
- **la sesión caduca a los 30 días**; entonces la bóveda se sigue abriendo sin
  conexión pero sincronizar pide volver a entrar.

## LA-032 — publicar la rama de la bóveda

Estado: `pending` — actualizado el 2026-09-02. Antes de F9.29, `HEAD` y
`origin/luxy/f9-1-vault-crypto` ya coincidían en `296fe9a`; los «13 commits sin
subir» sí se habían publicado. Ahora queda **F9.29 sin commit**, y por tanto aún
sin push. No se autoriza automáticamente ninguna de las dos operaciones.

Daniel pidió «haz commit y push». Es la autorización que exige `CLAUDE.md` para
publicar; queda registrada aquí porque no se generaliza a la próxima vez.

**Hecho:** dos commits en `luxy/f9-1-vault-crypto`, árbol limpio.

- `76511e2` — `feat: la boveda se abre desde cualquier equipo con la cuenta`
- `d7c57e8` — `docs: estado de la fase 9 tras unir la cuenta con la boveda`

Llevan la identidad `Daniel <danielux135@gmail.com>` pasada con `git -c`, porque
este equipo sigue sin identidad global (`LA-030`). No se escribió configuración
global: eso sigue siendo decisión de Daniel.

**El push lo hizo Daniel a mano.** `git push` desde la sesión de IA fue
**denegado por el sistema de permisos, sin mostrar diálogo**, exactamente igual
que en `LA-028` y `LA-030`; no faltaba su autorización, la había dado. Lo lanzó
desde una terminal fuera de la sesión:

```powershell
git push -u origin luxy/f9-1-vault-crypto
```

Verificado después contra el remoto: `origin/luxy/f9-1-vault-crypto` está en
`b12a5ec`, el mismo HEAD local; `origin/main` sigue en `00a9cc1`, sin tocar; y
ningún archivo sensible (`.env`, `.dev.vars`, `wrangler.toml`, `config.json`,
`vault.json`) aparece rastreado en ningún commit de la rama.

**Patrón que conviene recordar:** el `git push` de esta sesión de IA se deniega
solo, sin diálogo. No hay que insistir ni buscar el fallo en la autorización:
se lanza desde una terminal y ya está.

Sobre lo que se publica: **no se toca `main`** y no hay merge; la rama sigue
aislada, como todo el bloque `F9`. Es código y documentación, ningún secreto —
`vault.json`, `config.json`, `.env*` y `wrangler.toml` no están versionados, y
los `.example` sólo llevan valores `PENDIENTE_...`.

Publicar no despliega nada; el despliegue se hizo aparte y está en `LA-031`.

**Corrección del 2026-09-02:** esos 13 commits ya estaban publicados en
`296fe9a`. El pendiente actual es el worktree de F9.29, sin commit. Sigue
valiendo todo lo de arriba, incluido el patrón: cuando Daniel autorice el commit
y el push, el push se lanza desde una terminal externa si la sesión lo deniega.

```powershell
git push
```

## LA-031 — aplicar 0007, desplegar el gateway y probar la bóveda real

Estado: `done` — **2026-09-02**. Los cuatro primeros pasos ejecutados y
verificados; queda sólo la prueba con dos equipos y dos cuentas, que se recoge
abajo como `LA-033`.

**Lo que se hizo, en orden:**

1. `0007` aplicada. Comprobación de RLS: las cinco tablas `vault_*` con
   `rowsecurity = true`.
2. `0008` aplicada. `select id, public from storage.buckets where id =
   'vault-media'` → una fila con `public = false`.
3. Gateway desplegado desde este equipo: `luxy-gateway`, versión `44aee3d5`, en
   `https://luxy-gateway.danielux135.workers.dev`, con el cron de leases cada
   minuto. Se volvió a cargar `SUPABASE_URL` con `wrangler secret put` para
   descartar la trampa 3, y después se confirmó de forma barata: `/health` →
   200 con `configured: true`, y `POST /api/vault/login/start` con un correo
   inexistente → 200 con la respuesta señuelo. Eso prueba que la ruta existe y
   que **la consulta a `vault_users` funcionó**; si la tabla no estuviera en ese
   proyecto habría dado 500.
4. Clave del proveedor de imágenes guardada (en **Privado**, no en Conexiones),
   personaje creado y avatar generado. La API corrigió el contrato dos veces por
   el camino; está recogido en `CURRENT-TASK.md` y en `D-053`.

**Notas de ejecución que ahorran tiempo la próxima vez:**

- este ordenador es un clon nuevo y **no tenía `apps/gateway/wrangler.toml`**
  (está en `.gitignore`). Se copia del `.example` antes de desplegar;
- la terminal es **PowerShell 5.1**: `&&` no vale como separador, y la política
  de ejecución de scripts está en `Restricted`, así que `npx` falla. Se usan los
  atajos `.cmd`:

  ```powershell
  cd apps\gateway
  ..\..\node_modules\.bin\wrangler.cmd deploy
  ```

Estado anterior: `pending` — abierta el 2026-09-01, **desbloqueada** por
`F9.18`.

Lo que la bloqueaba era que no existía la interfaz de cuenta y que el vault de
cuenta no estaba unido a la bóveda local. **Ya lo está** (`D-047`, `D-048`): la
pantalla de cuenta existe, entrar trae la llave, y sincronizar autoriza por
sesión. Las tablas de `0007` ya tienen quien las use.

La migración ya está **completa**: `F9.19` metió sus seis columnas de
recuperación antes de aplicarla, que era la decisión que quedaba pendiente. A
partir de que se aplique, `0007` no se toca más.

En este orden:

1. **Confirmar contra qué proyecto de Supabase apunta el gateway** antes de
   nada. Ya pasó una vez: el Worker apuntaba a un proyecto y el SQL Editor a
   otro (trampa 3 de `docs/ARRANQUE-ORDENADOR-NUEVO.md`). El log del Worker trae
   `supabaseHost`.

2. **Aplicar `supabase/migrations/0007_luxy_vault.sql`** — **HECHO el
   2026-09-01.** La comprobación devolvió las cinco tablas `vault_*` con
   `rowsecurity = true`, que es exactamente lo que tenía que salir.

2b. **Aplicar `supabase/migrations/0008_luxy_vault_media_bucket.sql`** —
   pendiente. Crea el bucket privado `vault-media` donde van los bytes cifrados
   de imágenes y vídeos (`D-050`). Sin él, sincronizar medios falla con «falta
   crear el almacén de medios en Supabase»; el texto sigue funcionando.
   Comprobación después:

   ```sql
   select id, public from storage.buckets where id = 'vault-media';
   ```

   Debe salir una fila con `public = false`. Si sale `true`, PARAR: cualquiera
   con la URL podría descargar el ciphertext.

   Referencia de la comprobación de RLS del paso 2:

   ```sql
   select tablename, rowsecurity from pg_tables
   where schemaname = 'public' and tablename like 'vault%';
   ```

   Deben salir las cinco (`vault_users`, `vault_sessions`, `vault_conversations`,
   `vault_records`, `vault_media`) con `rowsecurity = true`. Si alguna sale
   `false`, PARAR: RLS no se activó y esas tablas quedarían expuestas.

3. **Desplegar el gateway** (`wrangler deploy` desde `apps/gateway`) para que las
   rutas `/api/vault/*` existan en producción. Requiere autorización explícita.

4. **Registrar la API de generación**: guardar la clave en **Privado →
   «Proveedor de imágenes»** (no en Conexiones: ese formulario rechaza los
   nombres reservados) como
   `VAULT_MEDIA_API_KEY`, y hacer UNA generación real de prueba con un prompt
   neutro, para confirmar que el contrato del adaptador (nombres de campo, 201
   vs 202, sondeo, formato de error) coincide con la API de verdad.

5. **Probar el flujo de cuenta**: registrar una cuenta desde Privado, entrar
   desde un segundo equipo con sólo el correo y la contraseña, y sincronizar.
   Verificar que en el `.jsonl` local y en Supabase no hay texto legible.

   Lo que hay que mirar con atención, porque nunca se ha ejecutado de verdad:

   - que `withVaultAuth` **no** deja a un usuario leer los registros de otro.
     Con dos cuentas registradas, sincronizar desde una no puede traer nada de
     la otra. Es lo único que sólo se confirma con Postgres delante;
   - que la bóveda de Daniel, creada **antes** de que existieran las cuentas, se
     vincula con «Vincular a una cuenta» sin perder nada de lo ya cifrado.
     **Guardar la clave de recuperación nueva que sale ahí**: la anterior deja
     de valer;
   - que la clave de recuperación entra desde el segundo equipo sin saber la
     contraseña, y que después se puede elegir una nueva;
   - que cambiar la contraseña desde un equipo echa al otro, y que el otro
     vuelve a entrar con la nueva.

Registrar cada paso y su resultado real aquí abajo cuando se hagan.

## LA-030 — configurar la identidad de Git de este ordenador

Estado: `pending` — abierta el 2026-09-01.

Este equipo no tiene `user.name` ni `user.email` en ningún ámbito
(`git config --list --show-origin | grep user.` no devuelve nada). Los commits
existentes de la historia son `Daniel <danielux135@gmail.com>`.

`BUG-GIT-IDENTITY-001` ya hace que **Luxy** no dependa de esto: `commitWorktree`
aporta una identidad de respaldo cuando el equipo no tiene ninguna. Pero los
commits que Daniel haga **a mano desde una terminal** seguirán fallando.

Intentado desde la sesión de IA y **denegado por el sistema de permisos sin
mostrar diálogo**, igual que el `git push` de `LA-028`. Hay que ejecutarlo desde
una terminal fuera de la sesión:

```
git config --global user.name "Daniel"
git config --global user.email "danielux135@gmail.com"
```

Comprobación: `git config --list --show-origin | grep user.` debe mostrar las
dos entradas con origen en el `.gitconfig` global.

Actualización `LA-032`: `LUX-SKA7` ya es la prueba nueva que confirma
`list_files` y `write_file`. Tras el reinicio de Desktop con `KIMI-K3-RETRY-001`,
pulsa **Reintentar trabajo** en ese mismo registro: debe reutilizar su worktree
y, si hay otro corte transitorio, mostrar `conexion con el proveedor
interrumpida` y reintentarlo antes de fallar.

Actualización `LA-032`: `LUX-BHM8` fue una prueba nueva y reveló un defecto SSE
local, ya corregido. Crear ahora un trabajo nuevo con Kimi K3; debe registrar
`herramienta write_file` y `write_file: hecho` antes del resultado final.

## LA-031 — permitir Luxy y registrar `DESKTOP-VM5J5GT`

Estado: `done` — cerrada el 2026-08-31. Desktop registró `portatil-oscar` con
la ID `6f34d4b8-5927-43ee-a0d0-360ac54f3c01`; `config.json` no contiene token
en claro, `secrets.enc` cifrado existe, el secreto temporal se retiró del
portapapeles y el reinicio confirmó `agente listo`.

Revalidado el 2026-08-31: el Gateway continúa sano; Wrangler está instalado
y ya autenticado por Daniel en la cuenta correcta; Electron vuelve a quedar
bloqueado por la misma política; no existe certificado local de firma de
código. El wizard de terminal antiguo no es una alternativa aceptable porque
escribe el token en `config.json`.

`CiTool` confirma que la política es Smart App Control
`VerifiedAndReputableDesktop`, en enforcement. No se debe apagar Defender ni
Smart App Control. La política admite suplementos; la salida acotada es una
regla por hash para los nueve binarios nativos exactos de Electron 43.2.0.

App Control Wizard 2.8.0.0 ya está instalado. La primera creación, mediante
`Folder Scan` sobre `node_modules\\electron\\dist`, produjo el XML
`Luxy-Electron-43.2.0.xml`, pero éste contiene `<FileRules />`: no hay hashes,
así que no se convirtió ni desplegó el `.cip` anunciado por el asistente.

Paso manual inmediato: desde la pantalla actual, volver a **Home → Policy
Creator** y crear la misma política suplementaria, pero con **+ Add Custom
Rule → File Hash → Allow → Usermode Rule**, seleccionando exactamente
`node_modules\\electron\\dist\\electron.exe`. Antes de pulsar cualquier
despliegue, volver a Codex para inspeccionar que el XML contiene una regla hash.
Si está presente, se aplicará la política mínima y se añadirán más binarios sólo
si los eventos de Code Integrity los reclaman.

Actualización 2026-08-31: no continuar con esa política. Las dos pruebas de
Wizard produjeron XML vacíos y el error real de inicio era
`ELECTRON_RUN_AS_NODE=1`, no Code Integrity. Codex ya abrió Desktop retirando
esa variable sólo de la sesión. También rotó el secreto autorizado y lo dejó en
el portapapeles de Windows; no está en este documento ni en el repositorio.

No queda ninguna acción administrativa de App Control ni de registro. La prueba
real de una API China queda pendiente de que Daniel configure una clave válida y
autorice su consumo.

## LA-032 — prueba real y acotada de Kimi K3

Estado: `in_progress` — abierta el 2026-08-31 por petición de Daniel.

En **Trabajos**, crear un trabajo nuevo con el modelo **Kimi K3** y pedir una
edición pequeña, por ejemplo crear `kimi-prueba.txt` con una línea dentro del
worktree. Revisar que el detalle muestre una herramienta ejecutada, un diff y
archivos modificados. No reintentar `LUX-A9K9`: no cambió archivos y ya consumió
su llamada. Si Kimi no completa el ciclo, devolver el detalle a Codex; no activar
ningún permiso adicional ni realizar push.

El catálogo de 19 modelos se ha reconstruido y verificado, pero la ventana de
Luxy que ya está abierta conserva la compilación anterior. Tras completar el
onboarding, Codex la reiniciará sin `ELECTRON_RUN_AS_NODE` para mostrar el
catálogo nuevo; no hace falta volver a pegar el secreto.

### 1. Conseguir un secreto temporal de registro

El Gateway correcto es:

```text
https://luxy-gateway.danielux135.workers.dev
```

No hay una copia local de `MACHINE_REGISTRATION_SECRET` y Cloudflare no permite
leer el valor guardado. Daniel puede usar el que ya conoce o, si lo administra,
rotarlo desde Cloudflare para el Worker `luxy-gateway`. Alternativa desde una
terminal interactiva autenticada:

```powershell
npx wrangler login
npx wrangler secret put MACHINE_REGISTRATION_SECRET --name luxy-gateway
```

Esto modifica configuración de producción: Codex no lo ejecutó. Elegir un valor
aleatorio largo, introducirlo directamente en Cloudflare y después en Luxy; no
pegarlo en el chat ni guardarlo en el repositorio.

Daniel autorizó la rotación y completó `npx wrangler login` el 2026-08-31. Codex
la deja deliberadamente pendiente hasta que Electron pueda abrir: así el nuevo
secreto se genera, se introduce en Luxy y se descarta en una sola sesión.

### 2. Autorizar una compilación firmada

Windows rechazó el Electron de desarrollo por nivel de firma empresarial. La
evidencia que debe recibir el administrador es:

- Code Integrity, eventos `3033` y `3077`;
- Policy ID `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`;
- ejecutable bloqueado: `node_modules\electron\dist\electron.exe` del worktree.

La solución durable es firmar el paquete de Luxy con un certificado confiado
por esa política y autorizar su publisher. Una regla hash para el Electron
actual sirve sólo como desbloqueo de desarrollo y caducará al cambiar el
binario. No desactivar Code Integrity ni usar un bypass.

### 3. Completar el onboarding

Cuando el binario esté permitido:

1. abrir Luxy desde este worktree; el nombre propuesto será
   `desktop-vm5j5gt` (se puede cambiar por `oscar-desktop-vm5j5gt`);
2. pegar la URL anterior y el secreto temporal; pulsar **Comprobar** y después
   **Registrar máquina**;
3. copiar la UUID que aparecerá como **ID de máquina**; también quedará en
   `%APPDATA%\Luxy\config.json`, mientras el token irá cifrado a `secrets.enc`;
4. en Herramientas deben aparecer Node, npm y Git. Claude Code, Codex CLI y
   `rtk` no están detectados actualmente;
5. se puede omitir la API HTTP si aún no hay clave;
6. añadir como proyecto `luxy` la carpeta
   `C:\Users\oscar\Desktop\Daniel\Luxy` y mantener `allowPush: false`;
7. terminar el asistente y comprobar en Inicio: agente en marcha, Gateway
   conectado y máquina online.

Después de esos pasos, volver a pedir a Codex que verifique sin exponer valores:
existencia de config, `machineId`, token cifrado, heartbeat, herramientas y
proyecto anunciado.

## LA-030 — integrar y validar la biblioteca de conversaciones

Estado: `pending` — abierta el 2026-08-28. La implementación y la batería
automatizada están completas; no hay commit, publicación ni prueba visual.

1. Revisar el diff de `luxy/f2-4-conversation-library` y autorizar, si procede,
   el commit local de `F2.4-T1`.
2. Integrar esa rama en `main` por el flujo que Daniel elija.
3. Autorizar y publicar Gateway, porque se añade
   `POST /api/studio/jobs/:jobId/conversation`.
4. Reconstruir y arrancar Desktop/agente desde la línea integrada.
5. En Conversaciones, comprobar con datos reales: renombrar, buscar por una
   frase de una respuesta, archivar, abrir la vista Archivadas, restaurar y
   enviar un turno posterior conservando el título.

No hace falta migración. La validación automatizada no llamó a proveedores ni
alteró conversaciones reales.

## LA-029 — publicar y validar proveedores HTTP dinámicos

Estado: `pending` — abierta el 2026-08-27, actualizada el 2026-08-28. El commit
local ya fue autorizado, creado e integrado en `main`/`origin/main` como
`00a9cc1`; falta publicar y validar.

1. Integración completada: `main` y `origin/main` apuntan a `00a9cc1`.
2. Autorizar y ejecutar la publicación del Gateway, porque cambia el contrato de
   proveedores que Studio recibe.
3. Reconstruir y arrancar Desktop/agente desde la línea integrada.
4. En **Conexiones**, añadir una API compatible con `chat completions`, guardar
   su clave, confirmar que aparece en Trabajos y Conversaciones y ejecutar una
   petición manual sólo si se acepta su posible coste.
5. Editar el endpoint y comprobar que Luxy exige introducir de nuevo la clave;
   eliminar el proveedor y confirmar que desaparece de los selectores.

No hace falta migración de base de datos. La implementación automatizada no
llamó a ninguna API real.

## LA-028 — completar el push de `main` (LUXY-CONSOLIDATION-001)

Estado: `pending` — abierta el 2026-08-21, actualizada el mismo día tras
renombrar la rama local. Autorizada explícitamente por Daniel (dos
confirmaciones: aprobación en chat y confirmación directa de que no había
prompt de permiso pendiente); bloqueada por el entorno, no por falta de
autorización.

`git push` fue denegado dos veces por el sistema de permisos de esta sesión,
sin mostrar ningún prompt de aprobación — parece una restricción dura del
entorno para operaciones de red de Git, no algo que se pueda resolver
reintentando o confirmando de nuevo en el chat.

**Cambio tras la primera apertura de esta acción:** Daniel pidió una rama
canónica con un nombre claro. El checkout local `feat/luxy-desktop` se
renombró a `main` (`git branch -m`): es un cambio puramente local y
reversible. `origin/HEAD` en el remoto ya apunta a `origin/main`
(`c6e5094`), que es **ancestro directo** del HEAD actual — no hay divergencia,
así que empujar a `main` es un fast-forward limpio, no una reescritura de
historia. `origin/feat/luxy-desktop` (`65ca161`) queda intacto en el remoto,
sin actualizar; decidir qué hacer con esa rama remota (dejarla, o borrarla
una vez confirmado el push a `main`) es una decisión aparte, no incluida
aquí.

Estado verificado antes de pedir el push: HEAD `02c2080`, working tree
limpio salvo el ruido conocido y documentado de `.codebase-memory/` (ver
`AI-WORK-PROTOCOL.md` §9), sin secretos tracked/staged, sin cambios de
producto pendientes. 32 commits por delante de `origin/main`, sin
`--force`, sin tocar ninguna otra rama.

```powershell
cd C:\Users\daniel\Desktop\Luxy
git push origin main
```

Resultado esperado: `origin/main` avanza de `c6e5094` a `02c2080` (o al HEAD
que tengas en el momento de ejecutarlo) por fast-forward. Si git pide
credenciales o hay algún rechazo del remoto, pega aquí la salida exacta.

## LA-026 — borrar el respaldo temporal de la memoria MCP (opcional)

Estado: `pending` — abierta el 2026-08-21, no bloquea nada.

Durante `LUXY-CONSOLIDATION-001` se movió aside el índice MCP local previo a
fusionar `luxy/consolidate-worktrees` en `feat/luxy-desktop`, porque
colisionaba con la versión versionada que trajo el merge. Ya se reindexó y
verificó la memoria MCP sobre la línea canónica (`e40268a`), así que este
respaldo ya no hace falta. El entorno denegó el permiso para borrarlo por
comando (`rm -rf`), así que queda pendiente de que lo borres tú a mano si
quieres:

```powershell
Remove-Item -Recurse -Force "C:\Users\daniel\Desktop\Luxy\.codebase-memory.pre-merge-backup"
```

No es información tuya: es un caché regenerable de la herramienta de memoria.
Nada se pierde si lo borras.

## LA-027 — auditar las 12 vulnerabilidades de `npm install`

Estado: `pending` — abierta el 2026-08-21, deliberadamente pospuesta.

Al sincronizar `node_modules` con el `package-lock.json` fusionado durante
`LUXY-CONSOLIDATION-001`, `npm install` informó **12 vulnerabilidades: 5
moderate, 6 high, 1 critical**. No se ejecutó `npm audit fix` ni
`npm audit fix --force` a propósito: podría introducir cambios de versión
incompatibles sin control, y la instrucción explícita fue posponerlo hasta
cerrar la consolidación. Revisar con `npm audit` cuándo quieras auditarlo,
decidiendo caso por caso qué actualizar; no aplicar `--force` sin revisar el
changelog de cada paquete afectado.

## LA-025 — confirmar que un trabajo no bloquea la interfaz

Estado: `pending`.

Ejecutar `rebuild-and-start-luxy.bat`, terminar un trabajo manteniendo Luxy en
primer plano y comprobar que no aparece el aviso nativo de Electron. Al acabar,
los desplegables y campos de Trabajos, Conversaciones y Laboratorio deben seguir
respondiendo. Los avisos sí deben conservarse cuando Luxy esté minimizado o en
segundo plano.

## LA-024 — validar espacios de trabajo persistentes

Estado: `pending` — requiere publicar Gateway y reconstruir Desktop/agente.

1. Ejecutar `deploy-gateway.bat` desde la carpeta principal de Luxy.
2. Ejecutar `rebuild-and-start-luxy.bat` desde esa misma carpeta.
3. En Trabajos, pulsar **Preparar carpeta**, abrirla y crear un archivo de
   contexto antes de enviar la tarea.
4. Ejecutar una tarea que lea ese archivo; al terminar, cambiar de pantalla y
   volver. El mismo worktree debe seguir seleccionado.
5. Ejecutar otra tarea y comprobar en el detalle que conserva exactamente la
   misma ruta y rama, sin crear otra carpeta.

No requiere commit, push ni migración. El deploy sólo publica el contrato nuevo
de Gateway; no se ha hecho automáticamente.

## LA-023 — desplegar manualmente el contrato Hunyuan del Gateway

Estado: `pending` — requiere acción explícita de Daniel.

Ejecutar por doble clic `deploy-gateway.bat` desde la raíz del worktree. El
script compila Shared/Gateway, prepara un dry-run y pide escribir `DESPLEGAR`
antes de publicar. Usa `--keep-vars`, no cambia secretos y no aplica
migraciones. Tras terminar, esperar unos segundos y comprobar que desaparece el
aviso 422 del agente.

Este archivo sólo contiene acciones que una IA no debe ejecutar por su cuenta.
No repetir una acción marcada como completada sin una razón nueva.

## LA-023 — validar la rama de consolidación al finalizar

Estado: `pending`

Cuando termine `CONSOLIDATE-WORKTREES-001`, abrir Luxy desde esa rama y validar
Trabajos, workspaces y el historial antes de retirar worktrees antiguos.

## LA-021 — comprobar el historial tras reiniciar Studio

Estado: `pending`

En **Trabajos**, verificar que desaparece el bloque técnico que decía
`invalid_enum_value` para `provider: hunyuan` y que el historial vuelve a listar
los trabajos. No crear ni reintentar un trabajo para esta comprobación.

## LA-022 — validar inicialización automática de Git

Estado: `pending`

Reconstruir y reiniciar Desktop/agente desde el worktree de `F4.8-T1`. Configurar
un proyecto editable que no tenga `.git` y lanzar un trabajo que escriba
archivos. Comprobar que aparece `inicializando repositorio Git`, que se crea el
commit local `estado inicial`, que `.env` y `node_modules` no entran en él y que
el trabajo continúa en un worktree `luxy/...`.

No se crea remoto ni se hace push. Si se cancela el trabajo, conservar el
worktree y sus cambios para inspección.

## LA-022 — validar reanudación del mismo worktree

Estado: `pending`

Precondiciones completadas el 2026-08-10: Desktop reconstruido y arrancado desde
este worktree; Gateway desplegado en la versión
`a5cb5ba8-34d9-4cca-85ba-e02f95e3942f` y `/health` HTTP 200. El bundle actual
incluye el timeout ampliado del proveedor.

Después de reconstruir Desktop/agente, lanzar una tarea que cree al menos un
archivo y provocar un fallo temporal del proveedor. En el detalle, pulsar
**Reintentar trabajo** y aceptar. Debe aparecer `reanudando worktree aislado` y
la ruta/rama `luxy/...` debe ser la misma del intento anterior. El nuevo ID
audita el segundo intento, pero no debe crear una segunda carpeta ni una página
vacía.

Tras F4.8-T4, comprobar además que el primer mensaje del modelo reanudado no
anuncia una nueva “llamada 1” como si no existiera trabajo previo: debe revisar
`git_status` y continuar desde los archivos actuales. Un HTTP 503 visible debe
registrarse como fallo del proveedor, no como creación de un worktree nuevo.

## LA-001 — abrir el checkpoint en VS Code

Estado: `pending`

```powershell
Set-Location "$env:USERPROFILE\AppData\Local\Luxy\worktrees\luxy-work-update-001"
code .
```

Resultado esperado: VS Code abre la rama aislada, no la carpeta original de
Luxy.

## LA-002 — capturar estado real antes de continuar

Estado: `done` — 2026-08-05, ejecutado por Claude Code dentro del worktree.

Sólo comandos de lectura. Resultado: rama `luxy/work-update-001-studio`, HEAD
`61fb7ee`, migraciones `0001`–`0006` presentes e intactas y los tres parches
finales aplicados. Detalle en `CHANGELOG-WORK.md` y `TEST-RESULTS.md`. No hace
falta repetirlo salvo que cambie el worktree desde fuera.

Ejecutar en la terminal de VS Code y pegar la salida a la IA:

```powershell
git status --short --branch
git diff --stat
Get-ChildItem .\supabase\migrations\*.sql | Select-Object Name
```

Después comprobar únicamente los parches finales conocidos:

```powershell
$downloads = Join-Path $env:USERPROFILE "Downloads"
$patches = @(
    "luxy-conversations-signal-finalization.patch",
    "luxy-conversations-outcome-token-finalization-fix.patch",
    "luxy-conversations-feedback-single-click-fix.patch"
)

foreach ($name in $patches) {
    $path = Join-Path $downloads $name
    if (Test-Path $path) {
        git apply --reverse --check $path 2>$null
        [pscustomobject]@{
            Patch = $name
            Present = ($LASTEXITCODE -eq 0)
        }
    }
}
```

No ejecutar `git apply`, `git reset`, `git checkout --`, commit, push ni
migraciones durante esta comprobación.

## LA-003 — arrancar Gateway local

Estado: `cuando haga falta probar Desktop`

```powershell
Set-Location "$env:USERPROFILE\AppData\Local\Luxy\worktrees\luxy-work-update-001\apps\gateway"
npx.cmd wrangler dev
```

Dejar esa PowerShell abierta. Resultado esperado:
`Ready on http://localhost:8787`.

## LA-004 — arrancar Luxy Desktop con el perfil aislado

Estado: `cuando haga falta probar Desktop`

```powershell
$realLocal = Join-Path $env:USERPROFILE "AppData\Local"
$profileRoot = Join-Path $realLocal "Luxy\test-profiles\studio-001"
$repository = Join-Path $realLocal "Luxy\worktrees\luxy-work-update-001"

$env:APPDATA = Join-Path $profileRoot "Roaming"
$env:LOCALAPPDATA = Join-Path $profileRoot "Local"

Set-Location $repository
npm.cmd run desktop:dev
```

## LA-005 — prompt inicial para Claude o Codex

Estado: `disponible`

```text
Continúa Luxy desde el estado real del repositorio. Lee primero AGENTS.md,
CLAUDE.md, PROJECT-STATE.md, CURRENT-TASK.md, MASTER-PLAN.md, DECISIONS.md,
CHANGELOG-WORK.md, TEST-RESULTS.md, LOCAL-ACTIONS.md y AI-WORK-PROTOCOL.md.
No repitas la auditoría, no limpies cambios y no hagas commit, push, deploy ni
migraciones. Confirma el ID activo, contrasta git status/diff y continúa el
siguiente paso documentado. Actualiza la documentación después de cada paso.
```

## LA-006 — repetir la prueba de la web larga

Estado: `listo para ejecutar` — actualizado 2026-08-05 tras `P0.3b`.

**Lo que ya no hace falta demostrar:** las dos ejecuciones del 5 de agosto
(`LUX-YJT9` y `LUX-8B8T`) terminaron bien —`done_marker`, `finish_reason: stop`,
sin aborto— y llegaron enteras: 7.716 y 7.691 caracteres. El corte era el tope
de guardado de 4.000, ya corregido. Esta repetición sirve para **confirmar el
arreglo**, no para volver a diagnosticar.

Espera ver la respuesta completa y el panel de memoria de vuelta.

Antes hay que **reconstruir y reiniciar Desktop**: el corte estaba en el agente,
así que un Studio ya abierto sigue usando el código viejo. Ver `LA-004`.

- Proveedor y modelo: la conexión `hcnsec`, modelo `Kimi-K2.6`.
- Timeout efectivo: 3.600.000 ms (el del trabajo; las conversaciones no usan el
  tope corto de 5 min).
- `max_tokens` efectivo: **8.192**. Es el valor por defecto del catálogo, y para
  una página de 1.000–2.000 líneas probablemente se quede corto: ver `LA-007`.
- Coste esperado: del orden del anterior, unos 4,3 ¥ por generación completa.
- Qué debe devolver Daniel, sin secretos: la línea de evento del trabajo que
  empieza por `diagnostico de la respuesta:`. Lleva `final=`, `finishReason=`,
  `aborto=`, `duracion=`, `timeout=`, `maxTokens=`, `tokens=` y `caracteres=`.
  Con eso se decide si el corte se acabó o si queda otra causa.

Lecturas esperadas si todo va bien: `final=done_marker` o `final=body_closed`,
`aborto=ninguno` y la página entera. Si vuelve a salir `final=local_end`, el
cierre local sigue disparándose y hay que mirar otra vez el lado de Luxy. Si
sale `finishReason=length`, entonces sí era el tope de tokens y toca `LA-007`.

## LA-007 — confirmar el tope real de salida por modelo

Estado: `pending` — **confirmado que hace falta**, 2026-08-05.

Ya no es una sospecha: el trabajo `LUX-3966` con KAT Coder Pro v2.5 terminó con
`finish_reason: length` y exactamente **8.192 tokens de salida**, es decir
22.574 caracteres, unas 700 líneas de HTML. El tope se alcanza de verdad.

El catálogo usa el valor genérico de 8.192 para todos los modelos y **nunca se ha
verificado** por modelo. En la consola del proveedor o en su documentación,
confirmar el `max_tokens` máximo que aceptan `Kimi-K2.6` y `kat-coder-pro-v2.5`.

No lo subo por mi cuenta: poner un número inventado provocaría errores 400 del
proveedor o respuestas cortadas de otra forma. Con el dato real, el cambio es una
línea en `packages/shared/src/models/catalog.ts`.

## LA-011 — decidir dónde vive un artefacto largo

Estado: **`resuelta` el 2026-08-06.** Daniel eligió **archivo en su disco**, con
el tope de 2 MB propuesto. Implementado en `P0.6c`; ya no bloquea nada.

`P0.6a` y `P0.6b` ya unen los fragmentos de una respuesta continuada, pero el
documento sigue viviendo en el `resultSummary` de cada trabajo. `D-013` dice que
eso no puede ser el almacén, y `D-020` insiste: cuando algo no quepa, la ruta es
el artefacto, no subir el tope.

No escribo código hasta que esto esté decidido, porque el almacenamiento marca
los límites de seguridad de todo lo demás.

Propuesta, para aprobar o corregir:

- lo escribe **el agente**, en `%LOCALAPPDATA%\Luxy\artifacts\<jobId>\<nombre>`;
- ruta validada con `paths.ts`, nunca fuera de esa carpeta, sin `..` ni rutas
  absolutas venidas del modelo;
- tope por archivo y por trabajo, con aviso explícito al alcanzarlo;
- el gateway guarda **sólo la referencia** en la metadata: nombre, tamaño, hash
  y trabajo de origen. Ningún contenido sale de la máquina;
- Studio abre la carpeta; no sirve el archivo por HTTP.

Coste 0 €, sin Supabase Storage, sin servicios facturables y sin abrir puertos.

Qué necesito de Daniel: sí/no a esa ubicación, y si el tope por archivo debe ser
algo distinto de 2 MB.

## LA-012 — confirmar que el sondeo ya no desborda Supabase

Estado: `pending` — abierta el 2026-08-06 tras `P0.8`.

Observado por Daniel: **29.432 peticiones al API Gateway en 60 minutos**, 100 %
de éxito, con el mismo bloque repitiéndose cada menos de 3 s en `wrangler`.
Causa demostrada y corregida en `P0.8`: Studio pedía el detalle de cada
respuesta terminada cada 1,5 s.

El arreglo está en el renderer, así que **hace falta reconstruir y reiniciar
Studio**: uno ya abierto sigue con el código viejo (ver `LA-004`).

Cubre también `P0.9`: durante una generación en esta máquina el texto ya no se
pide por red, sale del bus de eventos del agente local.

Qué mirar después, con Studio abierto y sin ninguna respuesta corriendo:

- en `wrangler`, el bloque debe pasar a repetirse cada ~10 s, y con la ventana
  de Studio en segundo plano cada ~60 s;
- ya **no** deben aparecer varias líneas `GET /api/studio/jobs/<uuid>` seguidas.
  Tampoco durante una generación: con `P0.9`, mientras el modelo escribe debería
  verse el texto avanzar en pantalla **sin** peticiones nuevas, y una sola
  ráfaga corta al terminar;
- en el panel de Supabase, «Total Requests» de la última hora debería bajar de
  ~29.000 a unos pocos miles.

Lo que seguirá apareciendo y es correcto: `POST /api/jobs/claim` cada 2 s,
`POST /api/machines/heartbeat` cada 10 s y `GET /api/approvals/pending`. Es el
agente, y es la decisión de arquitectura `0001`: sin puertos abiertos, sondea él.
Suma unas 1.800 reclamaciones a la hora.

Decisión tuya, si aun así quieres bajarlo: `pollIntervalMs` en
`%APPDATA%\Luxy\config.json` admite hasta 60.000 ms. Subirlo a 5.000 deja las
reclamaciones en ~720/h a cambio de que un trabajo tarde hasta 5 s en arrancar.
No lo cambio yo: es tu configuración de máquina y no está en el repositorio.

## LA-013 — completar el push

Estado: **`completada` — verificada el 2026-08-09.**

La rama local y `origin/feat/luxy-desktop` apuntan ambas a `59870c6`. Las
instrucciones inferiores se conservan como registro histórico; no hay que
repetir el push.

Daniel autorizó commit y push. El commit está hecho: `af095b3` sobre
`feat/luxy-desktop`, 33 archivos, +2.849/−116. **El push lo rechazó el sistema
de permisos del entorno**, así que la rama sigue sólo en este disco.

La rama no tiene upstream todavía, por eso hace falta `-u`:

```powershell
git push -u origin feat/luxy-desktop
```

Los archivos sin seguimiento se quedaron fuera a propósito y **no deben
commitearse**: `Claves Luxy Supabase test.txt`, `Luxy claves API.txt`, el
handoff duplicado y `Web demos/`. Los dos primeros contienen credenciales.

## LA-014 — leer el catálogo real de la pasarela

Estado: **`completada` por decisión — 2026-08-09.**

La segunda lectura mostró `/api/pricing` con 200 y 0 entradas, `/v1/pricing`
con 404 y `/api/models` con 200 y 0 entradas. Daniel decidió que, si la
pasarela no publica precios, Luxy no debe consultarlos. `F4.1-T5` elimina esos
sondeos; el botón actualiza únicamente la lista de modelos.

La lectura devolvió 22 modelos y cero precios reconocibles. Falta repetir
**Consultar a la pasarela** con el diagnóstico de tres rutas incorporado en
`F4.1-T3`; esa segunda lectura debe indicar código HTTP, claves superiores y
número de entradas por ruta.

En Studio → **Modelos** hay un panel nuevo, «Catálogo real de la conexión», con
el botón **Consultar a la pasarela**. Hace dos peticiones con tu clave —
`/v1/models` y `/api/pricing`— y guarda el resultado con fecha en
`%LOCALAPPDATA%\Luxy\catalog\hcnsec.json`.

Hace falta reconstruir y reiniciar Studio antes (`LA-004`). **Si no ves el panel,
es que sigues con el build anterior.**

Va junto con el arreglo de `F4.1-T2`: hasta ahora la pantalla de Modelos decía
«no disponible» de los 19 modelos porque interpretaba una lista vacía como «no
sirve ninguno». Tras reconstruir dirá «sin comprobar», y tras pulsar el botón
dirá la verdad.

Qué necesito de vuelta, y no lleva secretos: ese archivo JSON, o una captura del
panel. Con eso:

- se ajusta el parseo si la pasarela devuelve otra forma;
- se traducen los multiplicadores a coste real, que ahora **no** se convierten
  a propósito: sin saber la unidad de crédito, un número inventado sería peor
  que ninguno;
- se lleva el `maxOutputTokens` verificado al catálogo, que es lo que cierra
  `LA-007` y `F2.14`.

Si el botón da un error, el mensaje es el que devolvió la pasarela: pégalo tal
cual.

## LA-015 — el Worker apunta al proyecto de Supabase equivocado

Estado: **`resuelta` el 2026-08-07.** Daniel corrigió `SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY`, puso un `MACHINE_REGISTRATION_SECRET` nuevo y
volvió a registrar `portatil-clase`. Studio muestra 30 trabajos y la máquina
conectada. **Pendiente derivado: el PC también tendrá que re-registrarse**, su
token vive en el proyecto viejo.

**Demostrado con el log del Worker**, no supuesto:

| Quién                     | Proyecto                                                                     |
| ------------------------- | ---------------------------------------------------------------------------- |
| Worker desplegado         | ``swpal…` (el proyecto antiguo)` (esquema antiguo, `jobs` sin `created_via`) |
| Datos reales y SQL Editor | `ikkni…` — `luxy-studio-test`, 23 columnas                                   |

Hay que apuntar el Worker al segundo. Los valores salen de Supabase →
`luxy-studio-test` → **Project Settings → API**:

```powershell
cd C:\Users\daniel\Desktop\Luxy\apps\gateway
npx.cmd wrangler secret put SUPABASE_URL
# https://<ref-de-luxy-studio-test>.supabase.co
npx.cmd wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# la clave service_role DE ESE proyecto
```

Comprobación, sin adivinar: `npx.cmd wrangler tail --format pretty` y abrir
Trabajos. Si sigue fallando, la línea dirá `supabaseHost`; tiene que leer
`ikkni…`. Si lee el otro, el secreto no se aplicó.

Consecuencia esperada: el token de máquina de `portatil-clase` vive en el
proyecto viejo. Al cambiar, Luxy puede decir que el token no vale y habrá que
registrar la máquina otra vez desde Ajustes. No se pierde nada: los trabajos y
conversaciones están en `luxy-studio-test`.

Conviene además revisar que `apps/gateway/.dev.vars` apunte al mismo proyecto,
para que local y desplegado no vuelvan a divergir. Ese archivo no lo puede leer
la IA.

## LA-016 — retirar el portátil sin perder nada

Estado: **`completada` en Git — verificada el 2026-08-09.**

Los dos destinos remotos existen: `origin/feat/luxy-desktop` contiene el
checkpoint actual y `origin/luxy/phase-4d-session-host` apunta a `e27aa05`, el
commit de rescate. Las claves y `secrets.enc` siguen siendo material local y no
se incorporan al repositorio.

`portatil-clase` se va a retirar. Lo que está sólo en su disco desaparece.

### Lo que hay que subir, y no está en GitHub

```powershell
cd C:\Users\daniel\Desktop\Luxy
git push                                   # 265fd64, catalogo real + diagnostico

cd $env:LOCALAPPDATA\Luxy\worktrees\phase-4d-session-host
git push -u origin luxy/phase-4d-session-host   # e27aa05, fase 4d de Remote
```

El segundo se rescató el 2026-08-07: `session-host.ts` (611 líneas) y su prueba
(436) **no estaban en ningún commit**. El resto de ese worktree ya coincidía con
el repositorio.

Revisado y descartado: el worktree `luxy-work-update-001` es una foto **anterior**
a lo ya commiteado (no tiene `continuation.ts` ni `response-matrix.test.ts`), y
su contenido entró con `9012eda`. No hay nada que rescatar ahí.

### Lo que no puede subirse y hay que llevarse aparte

- la **clave de la API china** (está en tus archivos de claves del escritorio);
- el **`MACHINE_REGISTRATION_SECRET`** que generaste hoy;
- saber que **`secrets.enc` no es portable**: va cifrado contra la cuenta de
  Windows de este equipo. En el nuevo se vuelven a escribir las claves a mano.

Todo lo demás sobrevive solo: el gateway está desplegado y los datos están en
Supabase.

### Antes de apagarlo por última vez

```powershell
Get-ChildItem "$env:LOCALAPPDATA\Luxy\worktrees" -Directory | ForEach-Object {
    $n = (git -C $_.FullName status --porcelain 2>$null | Measure-Object).Count
    if ($n -gt 0) { "$($_.Name): $n archivos sin guardar" }
}
```

Si sale algún nombre, ahí queda trabajo sin commitear. Hay 16 worktrees en este
equipo y sólo dos tenían cambios.

## Operaciones no autorizadas

- Commit del checkpoint: **autorizado y hecho** el 2026-08-06 (`af095b3`).
- Push del checkpoint: autorizado, ejecutado y verificado (`LA-013`).
- Deploy de Wrangler: autorizado y ejecutado por Daniel el 2026-08-07; cualquier
  despliegue nuevo vuelve a requerir autorización.
- Aplicar `0005`, `0006` o cualquier migración: no autorizado.
- Producción: no autorizada.

## LA-017 — comprobar la evidencia local por modelo

Estado: `pending` — abierta el 2026-08-09 tras `F4.2-T1` y ampliada tras
`F4.2-T2`.

Reconstruye/reinicia Studio y abre **Modelos**. Cada modelo usado en el historial
revisado debe mostrar tasa de completas, mediana y finales problemáticos. Los
modelos sin muestra deben decir «sin ejecuciones atribuibles».

Comprobaciones concretas:

1. navegar fuera de Modelos y volver no produce sondeo continuo;
2. una cancelación aparece «aparte» y no baja la tasa del modelo;
3. un trabajo antiguo sin `responseOutcome` pero con estado `completed` cuenta
   como completo;
4. si falla la lectura del historial, aparece un aviso y el catálogo sigue
   visible.
5. crear un trabajo eligiendo un modelo exacto y comprobar que sus métricas
   aparecen bajo ese modelo;
6. crear otro trabajo eligiendo sólo una familia o su predeterminado y comprobar
   que aparece bajo el `apiModel` exacto realmente usado, no como trabajo sin
   atribución;
7. cancelar una respuesta en curso y comprobar que la cancelación se suma
   «aparte», bajo el modelo efectivo, sin reducir la tasa de completas.
8. encima del catálogo debe aparecer «Evidencia local: N trabajos revisados»;
9. con menos de 1.000 trabajos debe decir «historial reciente completo»;
10. si aparece «el gateway no avanzó al paginar», Studio está conectado a una
    versión anterior del Gateway. La prueba de paginación debe repetirse con el
    Gateway local actualizado o después de un despliegue expresamente
    autorizado;
11. entrar una vez en Modelos puede hacer varias lecturas consecutivas de 100,
    pero quedarse en la pantalla no debe repetirlas ni iniciar polling.

Antes de probar, reconstruye y reinicia tanto Studio como el agente. El campo
`executedModel` viaja desde el agente al gateway; dejar un agente antiguo en
ejecución haría que los trabajos nuevos siguieran sin esa evidencia.

`F4.2-T3` también cambia el Gateway. Reiniciar sólo Studio no actualiza la pieza
desplegada; no se ha hecho deploy en este paso porque necesita autorización.

## LA-018 — comprobar el catálogo del Laboratorio

Estado: `pending` — abierta el 2026-08-09 tras `F4.3-T1`.

Actualización 2026-08-11 (`F4.3-T11`): reiniciar Desktop/agente y confirmar que
Laboratorio ya no ofrece `Qwen3.5-397B-A17B` ni `Qwen3.6-35B-A3B`; debe usar los
modelos del último snapshot. Una evaluación activa debe desaparecer por sí sola
en unos 5 segundos tras terminar. Un 503 debe mostrar «Duración hasta el fallo»
y el grupo «Par terminado», nunca aparentar una respuesta válida.

Reconstruye/reinicia Studio y abre **Laboratorio** en la navegación lateral.

Comprobaciones concretas:

1. aparecen exactamente 8 pruebas definidas;
2. están rapidez, código, frontend, español, instrucciones, JSON, contexto largo
   y tool calling;
3. cada tarjeta muestra versión, identificador, prompt exacto, criterios y
   capacidades requeridas;
4. las seis pruebas que dependen de datos indican «fixture disponible», junto a
   su identificador, tipo y número de caracteres;
5. el aviso superior dice que sólo las pruebas automáticas pueden ejecutarse,
   que requieren confirmación, pueden consumir tokens y no se consulta precio;
6. rapidez, instrucciones, JSON y contexto largo pueden habilitar **Ejecutar
   prueba individual**; las otras cuatro muestran su motivo de bloqueo;
7. la navegación a Modelos y al resto de secciones sigue funcionando;
8. rapidez, instrucciones, JSON y contexto largo muestran «validador local»;
9. código muestra «runner aislado pendiente», frontend y español «revisión
   manual», y tool calling «traza pendiente».
10. en «Preparar una prueba», cambiar la prueba actualiza la lista de modelos
    compatibles y la longitud del prompt;
11. contexto largo muestra la fixture `numbered-context-anchors-v1` y una vista
    previa mucho mayor que las pruebas cortas;
12. el selector aclara que filtra capacidades declaradas y no verificadas;
13. abrir «Ver prompt final completo» muestra cabecera, instrucciones y, cuando
    corresponde, la fixture entre delimitadores;
14. cambiar prueba o modelo no crea trabajos ni produce peticiones al Gateway.
15. aparece una confirmación de consumo; al cambiar prueba o modelo se desmarca
    automáticamente;
16. «Resultados guardados» hace una lectura de los últimos 100 trabajos al
    abrir; si no hay evaluaciones muestra un estado vacío y no vuelve a pedir
    datos por sí solo;
17. pulsar «Actualizar» repite sólo esa lectura. Cambiar prueba/modelo no la
    repite ni crea trabajos.
18. si existe una evaluación activa válida, aparece un panel separado con ID,
    prueba, modelo y estado; no cambia solo mientras se observa la pantalla.
19. un trabajo fallido nuevo aparece `Sin puntuar` con motivo de fallo; un
    trabajo antiguo/interrumpido sin contrato aparece **Sin resultado validado**,
    no `No supera los checks`.
20. con 1 o 2 resultados puntuados del mismo modelo/prueba, **Evidencia
    descriptiva** dice `Muestra insuficiente`; sólo desde 3 muestra porcentaje;
21. cancelados y fallos operativos aumentan `sin puntuar`, pero no alteran tasa,
    mediana de duración ni tokens.
22. cambiar **Modo de ejecución** a **Comparar dos modelos**: aparece Modelo B,
    no permite repetir el modelo exacto y avisa si la máquina no ofrece su
    proveedor;
    El selector de prueba debe mostrar sólo 4 opciones automáticas; Frontend,
    Código, Español y Tool calling sólo aparecen en las fichas inferiores;
23. marcar la confirmación y pulsar el botón sólo hasta ver el diálogo: debe
    enumerar A, B, máquina, dos ejecuciones y ausencia de precios. Pulsar
    **Cancelar** no crea trabajos ni consume tokens;
24. prueba real opcional: aceptar el diálogo crea dos IDs y ambos aparecen en
    **Evaluación activa** tras Actualizar. Esta acción sí llama a los modelos y
    puede consumir tokens; no es necesaria para validar la interfaz.
25. cuando exista un par guardado, **Comparaciones controladas** debe mostrar un
    único grupo con A y B. Si sólo existe A o un miembro terminó sin resultado,
    debe indicarlo como parcial/sin validar, nunca elegir ganador ni buscar otro
    trabajo cercano para completar el par.
26. en **Resultados guardados**, abrir **Ver evidencia reproducible**: comprobar
    proveedor, proyecto, máquina, modo, scoring, prompt y respuesta completos;
    cerrar/abrir el detalle no realiza red;
27. con menos de dos modelos que tengan 3 resultados puntuados de la misma
    prueba/versión, **Recomendación local** debe decir **Sin recomendación**;
28. al alcanzar ese umbral, debe mostrar una propuesta provisional y su razón.
    Un empate real sigue sin ganador; cancelados/fallos operativos no empeoran la
    tasa;
29. pulsar **Seleccionar modelo** sólo cambia Modelo A. La casilla de confirmación
    queda desmarcada y no se crea ningún trabajo.

Esta comprobación necesita reconstruir Desktop y tener accesible el Gateway ya
configurado para leer el historial. No requiere agente activo, clave de
proveedor, ejecución real ni deploy nuevo.

`F4.3-T5` no añade ningún cambio visual ni una acción manual nueva: prepara la
validación del cierre en Gateway, pero no crea trabajos. No se debe intentar
fabricar una evaluación mediante API para probarlo; la cobertura automatizada
comprueba ese contrato sin consumir tokens.

## LA-019 — primera evaluación individual

Estado: `pending` — requiere decisión de Daniel porque consume tokens.

Requisitos: reconstruir/reiniciar Desktop y agente con este worktree, y usar un
Gateway construido con `F4.3-T7`. El Gateway desplegado anteriormente no conoce
este contrato; no se ha desplegado nada en este paso. El código está en el
checkpoint local de Modelos/Laboratorio, todavía sin push.

Prueba mínima recomendada:

1. abrir **Laboratorio** y seleccionar **Rapidez de respuesta corta**;
2. elegir una máquina conectada, proyecto y un modelo exacto que se quiera
   probar;
3. comprobar que el precio aparece como desconocido, sin peticiones de precio;
4. marcar la confirmación y pulsar **Ejecutar prueba individual**;
5. revisar el diálogo: debe repetir prueba, modelo y máquina. Cancelar no crea
   nada; aceptar sí puede consumir tokens;
6. al aceptar aparece un `LUX-…`; seguirlo en **Trabajos**;
7. mientras esté activo, Laboratorio debe bloquear una segunda evaluación;
8. para probar cancelación, pulsar **Cancelar** y rechazar el diálogo: no cambia
   nada. Aceptarlo una vez deja el botón como **Cancelación solicitada** y no
   permite repetirlo;
9. pulsar **Actualizar** hasta que el agente confirme el cierre: una cancelación
   debe aparecer `Sin puntuar`, nunca como fallo;
10. si se deja terminar, pulsar **Actualizar**: debe aparecer `Validada` sólo si la salida
    fue exactamente `LISTO`; cualquier corte queda `Sin puntuar`;
11. no debe existir worktree, diff, memoria ni comprobaciones de proyecto.

No probar todavía Código, Frontend, Español o Tool calling: Gateway debe
rechazarlos y no existe un runner seguro para puntuarlos.

## LA-008 — migración al ordenador nuevo: hecha

Estado: **`completada` el 2026-08-05 22:05**

El ordenador `N-2278` ya no se va a usar nunca más. Todo su trabajo está aquí.

- Repositorio activo: `C:\Users\Daniel\Desktop\proyecto github\Luxy`
- Rama activa: `luxy/work-update-001-studio` sobre `61fb7ee`
- Encima: **60 archivos modificados o nuevos, +7.997 / −128, sin commitear**

Respaldos, **fuera** del repositorio, en `C:\Users\Daniel\Desktop\luxy-recuperado\`:

| Carpeta o archivo                     | Contenido                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `luxy-work-update-001\`               | copia íntegra del worktree, 307 archivos                                  |
| `luxy-work-update-001-COMPLETO.patch` | el mismo delta como parche, aplica limpio sobre `61fb7ee`                 |
| `parches\`                            | los 12 `.patch` históricos y los handoffs                                 |
| `docs-de-esta-copia-2026-08-05\`      | los documentos desactualizados que tenía esta copia antes de la migración |

Se ejecutó `git worktree prune`: los metadatos apuntaban a
`C:\Users\daniel\AppData\Local\Luxy\worktrees\...`, rutas de una máquina que
ya no existe, y bloqueaban el `checkout` de la rama. Sin esa poda no se podía
continuar. No borró ningún commit.

### Pendiente

`%APPDATA%\Luxy\config.json` **no se copió**: contiene el token de máquina. Para
volver a ejecutar el agente en este ordenador hace falta:

```powershell
npm run setup:machine
```

### Riesgo abierto

Esas 7.997 líneas siguen sin estar en ningún commit. Sobreviven porque hay dos
copias fuera del repositorio, no porque git las guarde. Es exactamente el
supuesto de `D-016`, que sigue sin aceptarse.

## LA-010 — dejar este ordenador operativo

Estado: **`parcial` el 2026-08-05**. Falta únicamente información que sólo
tiene Daniel.

El commit `9012eda` trajo el trabajo, pero **el código no basta para ejecutar**:
la configuración de máquina y los secretos viven fuera del repositorio a
propósito, y el ordenador `N-2278` ya no responde por red (se comprobó).

### Hecho

| Qué                             | Dónde                    | Estado                                                                                     |
| ------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| Claves de la API China          | `.env.providers`         | escrito; ignorado por git                                                                  |
| Secreto de registro de máquina  | `apps/gateway/.dev.vars` | generado aquí, 24 bytes aleatorios                                                         |
| `service_role` de Supabase      | `apps/gateway/.dev.vars` | puesto                                                                                     |
| Secreto del webhook de Telegram | `apps/gateway/.dev.vars` | puesto                                                                                     |
| Herramientas                    | sistema                  | `node`, `npm`, `git`, `claude` y `codex` presentes; `wrangler` sólo como dependencia local |

Las tres variables de `.env.providers` apuntan a la **misma** conexión
(`https://api.hcnsec.cn/v1`, `DEFAULT_CONNECTIONS` del catálogo): hay una sola
clave para DeepSeek, GLM, Kimi y el resto.

### Pendiente, y por qué bloquea

`apps/gateway/.dev.vars` tiene cuatro valores `PENDIENTE_`. Sin ellos
`envSchema` no valida y el gateway no arranca, y sin gateway no hay registro de
máquina, luego no hay `config.json`, luego no hay agente ni Studio.

- `SUPABASE_URL`: no aparece en ningún archivo. Las claves nuevas
  (`sb_publishable_`, `sb_secret_`) no la codifican, al contrario que las
  antiguas en formato JWT.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_USER_ID` y `TELEGRAM_ALLOWED_CHAT_IDS`:
  `envSchema` los exige aunque sólo se quiera usar Studio.

Además hay una duda de estado real, no de configuración: según
`PROJECT-STATE.md` las migraciones **nunca se han ejecutado contra un Postgres
real**. Si ese proyecto de Supabase está vacío, aplicar
`supabase/migrations/0001`–`0006` es un paso que necesita autorización explícita
de Daniel.

### Aviso sobre el asistente

`npm run setup:machine` pide una URL de gateway y **rechaza lo que no empiece
por `https://`**. `wrangler dev` sirve en `http://localhost:8787`. Con el
gateway en local hay que escribir `config.json` a mano o usar un túnel.
## LA-020 — integrar y comprobar la trazabilidad de Trabajos

Estado: `parcial` — validación automática completa, commit local y Studio
reiniciado el 2026-08-20; falta integrar y desplegar el Gateway con autorización.

El cambio está aislado en la rama `luxy/ux-001-detalle-trabajo`. Antes de probar
la interfaz, Daniel debe aprobar el commit e integrar el cambio conforme al flujo
de worktrees. Después hay que reconstruir Shared, Agent y Desktop. El Gateway
también cambia: su despliegue requiere autorización explícita y no se ha hecho.

Con las tres piezas actualizadas, crea un trabajo HTTP agentic nuevo (por ejemplo
MiniMax) y abre **Trabajos**. El detalle debe mostrar `Llamadas al modelo`,
`Herramientas ejecutadas`, la ruta de **Carpeta de trabajo** y el botón **Abrir en
el Explorador**. Un trabajo anterior debe decir `No registradas`; no se estima la
cifra retrospectivamente. Si la tarea se ejecutó en otra máquina o ya se descartó
el worktree, el botón debe explicar que la carpeta no está disponible localmente.
