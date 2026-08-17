# Luxy — acciones locales de Daniel

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

## LA-021 — validar inicialización automática de Git

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
