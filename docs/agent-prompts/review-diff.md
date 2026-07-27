# Plantilla: revisar un diff

## Objetivo

Revisar un conjunto de cambios antes de aceptarlos. Indica qué diff: una rama
`luxy/...`, un worktree, o los cambios sin confirmar.

## Contexto necesario

```powershell
git status
git diff --stat
git diff
git log --oneline -10
```

Y `CLAUDE.md` del paquete afectado.

## Qué mirar, en este orden

### 1. ¿Hace lo que dice?
- ¿El cambio resuelve el problema planteado?
- ¿Se ha colado algo que nadie pidió?
- ¿Se ha eliminado funcionalidad existente?

### 2. Corrección
- Casos límite: entrada vacía, `null`, listas vacías, valores fuera de rango.
- Errores: ¿se manejan, o se tragan con un `catch` vacío?
- Concurrencia: ¿algo asume que solo hay una máquina o un trabajo?
- ¿Los `await` están donde deben? ¿Hay promesas sin esperar?

### 3. Seguridad
- ¿Algún `exec` o `shell: true` nuevo?
- ¿Entrada externa sin validar con Zod?
- ¿Alguna salida que no pase por `redact()`?
- ¿Rutas sin validar?
- ¿Secretos o rutas personales versionados?

### 4. Encaje con el diseño
- ¿La lógica pura acabó en `shared` y la de E/S fuera?
- ¿`shared` sigue sin importar `node:*`?
- ¿Se cambió una migración ya aplicada? (nunca)
- ¿El contrato gateway↔agente sigue siendo compatible?

### 5. Pruebas
- ¿Hay pruebas de lo nuevo?
- ¿Prueban el comportamiento o solo que el código se ejecuta?
- ¿Alguna prueba consume tokens o red real?
- ¿Se ha aflojado alguna aserción existente para que pase?

### 6. Estilo
- Comentarios en español, explicando el porqué.
- Imports relativos con extensión `.js`.
- Sin `any` fuera de mocks.
- Coherente con el código de alrededor.

## Restricciones

- Distingue **defectos** de **preferencias**. Marca cuál es cuál.
- Para cada defecto, da el escenario concreto que falla, no una vaga sospecha.
- No pidas cambios que contradigan `CLAUDE.md` o `AGENTS.md`.
- Si el diff está bien, dilo. No inventes objeciones.

## Verificación

Ejecuta las comprobaciones **de verdad**, no las supongas:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

## Formato del informe final

```
Resumen del diff:
  <qué cambia, en dos frases>

Defectos (hay que arreglar):
  1. <archivo:línea> — <qué falla> — <con qué entrada concreta>

Sugerencias (opcionales):
  1. <archivo:línea> — <qué mejoraría y por qué>

Comprobaciones ejecutadas:
  lint / typecheck / test / build → resultado real

Veredicto:
  <aceptable tal cual | aceptable con los defectos corregidos | requiere rehacer>
```
