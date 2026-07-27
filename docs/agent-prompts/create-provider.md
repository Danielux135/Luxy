# Plantilla: añadir un proveedor de IA

## Objetivo

Añadir un proveedor nuevo. Indica cuál y de qué tipo:

- **A. API HTTP compatible con OpenAI** → casi no requiere código.
- **B. CLI local con sesión de suscripción** → requiere un adaptador.
- **C. API con formato propio** → requiere un adaptador.

## Contexto necesario

- `docs/PROVIDERS.md`
- `apps/agent/CLAUDE.md`
- `packages/shared/src/types.ts` → interfaz `ProviderExecution`
- Un adaptador existente parecido: `providers/claude.ts`, `providers/codex.ts`,
  `providers/http-provider.ts`

## Caso A: API HTTP compatible con OpenAI

**No hace falta escribir código.** `HttpApiProvider` es genérico.

1. Añade su configuración a `providers.http` en `%APPDATA%\Luxy\config.json`:

```json
{
  "id": "nuevo",
  "displayName": "Nuevo",
  "baseUrl": "https://LA_URL/v1",
  "model": "EL_MODELO",
  "apiKeyEnv": "NUEVO_API_KEY",
  "enabled": true,
  "supportsStreaming": true,
  "maxOutputTokens": 8192,
  "dailyBudget": 0
}
```

2. Añade `NUEVO_API_KEY` a `.env.providers` y a `.env.providers.example`
   (en el `.example`, con valor `PENDIENTE_...`).
3. Añade `'nuevo'` a `PROVIDER_IDS` y a `HTTP_API_PROVIDERS` en
   `shared/constants.ts`.
4. Añade su etiqueta a `PROVIDER_LABELS` en `shared/telegram/format.ts`.
5. Añádelo a `PROVIDER_ALIASES` en `shared/telegram/commands.ts` para que se
   reconozca en lenguaje natural.
6. Añade `jobs_provider_check` en una **migración nueva** que amplíe el CHECK.
7. Considera dónde encaja en las preferencias del router (`shared/router.ts`).

## Casos B y C: adaptador propio

Crea `apps/agent/src/providers/<nombre>.ts` implementando `ProviderExecution`:

```ts
export class NuevoProvider implements ProviderExecution {
  readonly id = 'nuevo' as const;
  readonly displayName = 'Nuevo';

  async detect(): Promise<ToolPresence> { /* ... */ }
  async run(request: ProviderRunRequest): Promise<ProviderRunResult> { /* ... */ }
}
```

Regístralo en `LuxyAgent.initializeProviders()` y haz los pasos 3 a 7 del caso A.

### Si es un CLI (caso B)

**Obligatorio antes de escribir la invocación:**

```powershell
where.exe <ejecutable>
<ejecutable> --version
<ejecutable> --help
```

**No copies flags de la documentación ni de otra versión.** Escribe una función
`parseNuevoCapabilities(help)` que detecte qué admite realmente, como hacen
`parseClaudeCapabilities` y `parseCodexCapabilities`. Construye los argumentos
según lo detectado.

## Restricciones

- **Prohibido** usar la API de Anthropic o de OpenAI, y sus variables de entorno.
- **Prohibido** automatizar navegadores o interfaces web.
- **Prohibido** cualquier flag que salte permisos o sandbox.
- El prompt va como argumento separado o por stdin; **nunca concatenado**.
- La clave se lee de una variable de entorno; **nunca** en `config.json`, ni en
  Supabase, ni en git, ni en logs.
- No codifiques URLs ni modelos que puedan cambiar: van en la configuración,
  con valor `PENDIENTE_...` en los ejemplos.
- `run()` no lanza por fallo del proveedor: devuelve `ok: false` con un
  `errorMessage` que el usuario entienda.
- Respeta `timeoutMs` y el `AbortSignal`.

## Pruebas requeridas

- Construcción de argumentos: con capacidades completas y con una versión
  antigua limitada.
- **Que nunca aparezca ningún flag peligroso** en los argumentos generados.
- Parseo de la salida, incluidas líneas vacías y JSON roto.
- Traducción de errores (sesión caducada, rate limit, clave rechazada).
- Si es HTTP: presupuesto agotado y falta de clave, sin tocar la red.

Ninguna prueba puede consumir tokens reales.

## Verificación

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

## Formato del informe final

```
Proveedor añadido:
  <nombre, tipo A/B/C>

Versión detectada (si es CLI):
  <salida real de --version>

Flags comprobados con --help:
  <cuáles existen y cuáles no en esta versión>

Archivos modificados:
  <lista>

Pruebas añadidas:
  <cuáles>

Comprobaciones: lint / typecheck / test / build → resultado real

Pendiente de credenciales:
  <qué necesita el usuario para poder usarlo de verdad>
```
