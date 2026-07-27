# Plantilla: corregir un fallo

## Objetivo

Describe el **síntoma observado**, no la causa que supones.

> Ejemplo: al cancelar con `/cancel`, el proceso de Flutter sigue vivo en el
> Administrador de tareas.

Incluye si lo tienes:
- El identificador del trabajo (`LUX-XXXX`).
- La máquina donde ocurre.
- Si es reproducible siempre o a veces.

## Contexto necesario

```powershell
# logs del agente
Get-Content "$env:LOCALAPPDATA\Luxy\logs\luxy.log" -Tail 100

# logs del gateway
cd apps\gateway; npx wrangler tail
```

Y en Telegram: `/job LUX-XXXX` y `/logs LUX-XXXX`.

## Método

1. **Reproduce primero.** Si no puedes reproducirlo, no puedes saber si lo
   arreglaste.
2. **Escribe una prueba que falle** por el motivo correcto, antes de tocar el
   código de producción.
3. Arregla la **causa**, no el síntoma.
4. Comprueba que la prueba pasa y que no rompiste ninguna otra.

## Archivos probablemente afectados

| Síntoma | Dónde mirar |
|---|---|
| Un comando no se interpreta bien | `shared/telegram/commands.ts` |
| Máquina equivocada, o ninguna | `shared/machines.ts` |
| `/auto` elige mal | `shared/router.ts` |
| Un secreto aparece en un log | `shared/redact.ts` |
| Procesos que no mueren | `agent/process.ts` (`killProcessTree`) |
| `ENOENT` / `EINVAL` al lanzar algo | `agent/resolve-executable.ts` |
| Worktree o diff incorrectos | `agent/git.ts` |
| Trabajo colgado o duplicado | `supabase/migrations/0002_*.sql` |
| Mensaje que no llega a Telegram | `gateway/handlers/api.ts` (`deliverFinalMessage`) |

## Restricciones

- No "arregles" un test aflojando la aserción. Si la prueba estaba mal, dilo
  explícitamente y explica por qué.
- No suprimas errores con `try/catch` vacíos para que el síntoma desaparezca.
- No cambies el comportamiento de la reclamación atómica ni la condición
  `started_at is null` sin entender qué protegen.
- No elimines funcionalidad para simplificar la corrección.

## Pruebas requeridas

- Una prueba de regresión que **falle antes** del arreglo y **pase después**.
- Si el fallo era específico de Windows, dilo en el comentario de la prueba.

## Verificación

```powershell
npm test
npm run lint
npm run typecheck
npm run build
```

## Formato del informe final

```
Síntoma:
  <lo que se observaba>

Causa raíz:
  <por qué ocurría, con el archivo y la línea>

Corrección:
  <qué se cambió y por qué así>

Prueba de regresión:
  <archivo y nombre de la prueba; confirma que falla sin el arreglo>

Comprobaciones:
  lint / typecheck / test / build  →  resultado real

Riesgo residual:
  <casos parecidos que podrían seguir fallando>
```
