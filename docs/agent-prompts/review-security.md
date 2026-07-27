# Plantilla: revisión de seguridad

## Objetivo

Auditar un área concreta contra las garantías declaradas en `docs/SECURITY.md`.
Indica el alcance: un archivo, un flujo, o todo el repositorio.

## Contexto necesario

- `docs/SECURITY.md` — las garantías que hay que verificar.
- `CLAUDE.md` y `AGENTS.md` — reglas obligatorias.
- El diff a revisar, si aplica.

## Lista de comprobación

### Ejecución de procesos
- [ ] ¿Se usa `spawn` con ejecutable y argumentos separados en **todos** los casos?
- [ ] ¿Hay algún `exec`, `execSync` o `shell: true`? (debe haber cero)
- [ ] ¿Algún argumento se construye concatenando texto de Telegram?
- [ ] ¿La ruta `cmd.exe` valida los argumentos con `assertSafeForCmd`?
- [ ] ¿La cancelación mata el **árbol** de procesos?

### Entrada no confiable
- [ ] ¿Toda entrada externa se valida con Zod?
- [ ] ¿Hay límites de longitud en prompts y mensajes?
- [ ] ¿El contenido citado se marca como dato, no como instrucción?
- [ ] ¿Un archivo del repositorio podría cambiar el comportamiento de Luxy?

### Rutas
- [ ] ¿Se rechazan rutas relativas y con `..`?
- [ ] ¿Se comprueba la contención **por segmentos**, no con `startsWith`?
- [ ] ¿Se resuelven enlaces simbólicos antes de aceptar una ruta?
- [ ] ¿Alguna escritura puede caer fuera del worktree?

### Secretos
- [ ] ¿Hay algún secreto real en el repositorio? (busca `eyJ`, `sk-`, tokens)
- [ ] ¿Toda salida pasa por `redact()`?
- [ ] ¿Se registran los secretos cargados en `secretRegistry`?
- [ ] ¿Algún proceso hijo hereda el entorno completo?
- [ ] ¿La `service_role` aparece en algún sitio que no sea Cloudflare?

### Autorización
- [ ] ¿Se valida el secret token del webhook antes de nada?
- [ ] ¿Se comprueban usuario **y** chat?
- [ ] ¿Una máquina puede tocar trabajos de otra?
- [ ] ¿Los tokens se guardan solo como hash?
- [ ] ¿Las comparaciones de secretos son en tiempo constante?

### Base de datos
- [ ] ¿RLS activo en todas las tablas?
- [ ] ¿`anon` y `authenticated` sin permisos?
- [ ] ¿La reclamación sigue siendo atómica?

### Operaciones peligrosas
- [ ] ¿Algo hace `git push`, despliega o publica automáticamente?
- [ ] ¿Los commits requieren aprobación?
- [ ] ¿El push exige dos confirmaciones **y** `allowPush: true`?
- [ ] ¿Cancelar borra algún cambio? (no debe)

## Comandos útiles

```powershell
# buscar ejecucion por shell
npx eslint . ; Select-String -Path "apps/**/*.ts","packages/**/*.ts" -Pattern "exec\(|execSync|shell:\s*true"

# buscar secretos con forma reconocible
Select-String -Path "**/*.ts","**/*.sql","**/*.md","**/*.json" -Pattern "eyJ[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}"

# buscar rutas personales versionadas
Select-String -Path "**/*.ts","**/*.json","**/*.ps1" -Pattern "C:\\\\Users\\\\[A-Za-z]+\\\\"
```

## Restricciones

- **No corrijas nada durante la revisión.** Primero informa; el usuario decide.
- No des por buena una garantía sin comprobarla en el código.
- Si algo es una limitación aceptada y documentada, dilo, pero no lo cuentes
  como hallazgo nuevo.

## Formato del informe final

```
Alcance revisado:
  <qué archivos o flujos>

Hallazgos, de más grave a menos:
  [GRAVE  ] <descripción> — <archivo:línea> — <cómo se explota>
  [MEDIO  ] ...
  [LEVE   ] ...

Garantías verificadas:
  <las de la lista que has comprobado y están bien>

Garantías que NO he podido verificar:
  <y por qué>

Limitaciones ya documentadas que siguen vigentes:
  <sin contarlas como hallazgos>
```

Si no hay hallazgos, dilo claramente. **No inventes problemas para llenar el
informe.**
