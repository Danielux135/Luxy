# Luxy — protocolo de trabajo y relevo entre IA

Este contrato se aplica a Claude Code, Codex y cualquier otra IA que modifique
Luxy desde VS Code. Su objetivo es permitir cambiar de IA sin volver a auditar el
proyecto, perder decisiones o repetir llamadas costosas.

## 1. Regla principal

La memoria de trabajo vive en el repositorio, no en una conversación concreta.
Una explicación en el chat no sustituye la actualización de estos archivos.

Sólo una IA escribe en un worktree a la vez. Se puede cambiar de IA tantas veces
como sea necesario, pero el relevo documental es obligatorio.

## 2. Inicio de sesión obligatorio

Antes de proponer cambios:

1. Leer `AGENTS.md` y `CLAUDE.md` completos.
2. Leer `PROJECT-STATE.md` y `CURRENT-TASK.md` completos.
3. Leer la fase activa de `MASTER-PLAN.md`.
4. Leer `DECISIONS.md` completo.
5. Leer las dos últimas entradas de `CHANGELOG-WORK.md` y la última ejecución
   relevante de `TEST-RESULTS.md`.
6. Leer `LOCAL-ACTIONS.md` para no repetir acciones que ya hizo Daniel.
7. Ejecutar `git status --short --branch` y `git diff --stat`.
8. Leer los archivos de código implicados antes de editar.

La primera respuesta de la IA debe indicar:

- ID de la tarea activa;
- estado real encontrado;
- restricciones que aplican;
- archivos que espera tocar;
- pruebas que espera ejecutar;
- discrepancias, si las hay.

No producir otra auditoría general si estos documentos ya responden la duda.

## 3. Plan con identificadores

Toda tarea se divide en pasos con identificador estable, por ejemplo `P0.3` o
`F2.2-T1`.

Para cada paso:

1. Marcar `in_progress` en `CURRENT-TASK.md` antes de editar.
2. Registrar hipótesis y criterio de aceptación.
3. Implementar el cambio mínimo.
4. Ejecutar la prueba más cercana al fallo.
5. Registrar resultado inmediatamente en `CHANGELOG-WORK.md`.
6. Marcar `done`, `blocked` o `failed` con evidencia.
7. Actualizar el siguiente paso exacto.

No puede haber dos pasos `in_progress`. No se considera completado un paso que
sólo aparece como terminado en el chat.

## 4. Entrada obligatoria de changelog

Plantilla:

```markdown
### AAAA-MM-DD HH:MM — <IA> — <ID>

- Estado anterior:
- Objetivo:
- Hipótesis o causa demostrada:
- Archivos leídos:
- Archivos modificados:
- Comandos ejecutados:
- Resultado real:
- Pruebas:
- Decisiones:
- Riesgos o límites:
- Estado nuevo:
- Siguiente paso exacto:
```

Si un comando falla, se registra el comando y el fallo. No se sustituye por un
resumen como «hubo problemas ambientales» sin indicar cuáles.

## 5. Evidencia y lenguaje

Usar estas palabras con precisión:

- **Observado**: aparece en salida, captura o código leído.
- **Reproducido**: existe una prueba que falla por la misma causa.
- **Implementado**: el código cambió.
- **Verificado**: se ejecutaron las pruebas declaradas y pasaron.
- **Confirmado manualmente**: Daniel lo probó en Windows o con el proveedor real.
- **Hipótesis**: todavía necesita una prueba discriminante.

No convertir una hipótesis en causa. En especial, una respuesta incompleta no se
atribuye a tokens, timeout o socket sin `finish_reason`, evento de transporte o
evidencia equivalente.

## 6. Pruebas y consumo

- Tests automatizados: siempre mocks, nunca una API real.
- No ejecutar `test:live` salvo petición explícita de Daniel.
- Empezar por la prueba específica del fallo.
- Antes de cerrar un cambio importante: lint, tipos, suite y build.
- Guardar tiempos y conteos reales en `TEST-RESULTS.md`.
- Los fallos ambientales se conservan, no se eliminan ni se omiten para obtener
  un verde artificial.

## 7. Documentos que se actualizan al cerrar

En este orden:

1. `CHANGELOG-WORK.md`: evidencia cronológica.
2. `TEST-RESULTS.md`: comandos y resultado.
3. `CURRENT-TASK.md`: estados y siguiente acción exacta.
4. `PROJECT-STATE.md`: sólo si cambió una capacidad, incidencia o checkpoint.
5. `MASTER-PLAN.md`: sólo si cambió el estado de un ítem o el orden.
6. `LOCAL-ACTIONS.md`: sólo acciones que Daniel debe ejecutar fuera de la IA.
7. `DECISIONS.md`: sólo decisiones nuevas o sustituidas con motivo.
8. `AGENTS.md` y `CLAUDE.md`: arquitectura, comandos, seguridad o protocolo.
9. `FILE-MANIFEST.json`: si se añaden, mueven o eliminan archivos canónicos.

No reescribir entradas antiguas del changelog. Las correcciones se añaden como
una entrada nueva que referencia la anterior.

## 8. Cambio de Claude a Codex o de Codex a Claude

La IA saliente debe dejar:

- cero o un paso `in_progress` claramente descrito;
- archivos modificados enumerados;
- comandos ya ejecutados;
- pruebas pendientes;
- bloqueo concreto, si existe;
- siguiente comando o archivo a leer;
- ninguna promesa ambigua de «seguir luego».

La IA entrante:

- no confía en el chat anterior más que en el repositorio;
- no limpia cambios que no reconoce;
- compara documentación y diff;
- continúa el ID activo;
- pregunta sólo si falta una decisión que cambie materialmente la solución.

## 9. Operaciones reservadas a Daniel

Sin autorización explícita, ninguna IA puede:

- crear un commit;
- hacer push;
- desplegar Wrangler u otro servicio;
- aplicar migraciones;
- tocar producción;
- ejecutar una API real que consuma créditos;
- borrar un worktree con cambios;
- usar credenciales fuera del flujo ya configurado.

Esas acciones se escriben en `LOCAL-ACTIONS.md` con comando, motivo, resultado
esperado, riesgo y qué evidencia debe devolver Daniel.

## 10. Prompt de arranque recomendado

```text
Continúa Luxy desde el estado real del repositorio. Lee primero AGENTS.md,
CLAUDE.md, PROJECT-STATE.md, CURRENT-TASK.md, MASTER-PLAN.md, DECISIONS.md,
CHANGELOG-WORK.md, TEST-RESULTS.md, LOCAL-ACTIONS.md y AI-WORK-PROTOCOL.md.
No repitas la auditoría, no limpies cambios y no hagas commit, push, deploy ni
migraciones. Confirma el ID activo, contrasta git status/diff y continúa el
siguiente paso documentado. Actualiza la documentación después de cada paso.
```

## 11. Qué no debe guardarse aquí

- secretos, tokens, claves o cabeceras;
- prompts/respuestas privados completos;
- rutas personales salvo una instrucción local necesaria y ya conocida;
- HTML, CSS, JS o salidas generadas como si fueran memoria;
- resultados inventados o no ejecutados.
