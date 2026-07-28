// definiciones de las herramientas que puede pedir un modelo.
//
// El esquema de cada una se valida con zod ANTES de ejecutar nada: lo que llega
// del modelo es dato no confiable, igual que lo que llega de Telegram.
//
// Lo que NO existe aqui, y no es un olvido:
//   - shell / powershell arbitrarios
//   - acceso de red
//   - git push, git remote, git config
//   - despliegues
//   - cualquier ruta fuera del worktree
import { z } from 'zod';
import { AGENT_TOOL_NAMES, type AgentToolName } from '@luxy/shared';

/** ruta relativa al worktree; el confinamiento la valida despues */
const pathSchema = z.string().min(1).max(400);

export const TOOL_SCHEMAS = {
  list_files: z.object({
    path: pathSchema.default('.'),
    recursive: z.boolean().default(false),
  }),
  read_file: z.object({
    path: pathSchema,
    /** linea inicial (1-indexada) para leer solo un fragmento */
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
  }),
  search_files: z.object({
    /** patron glob simple sobre el nombre, no una expresion regular */
    pattern: z.string().min(1).max(200),
    path: pathSchema.default('.'),
  }),
  search_text: z.object({
    query: z.string().min(1).max(500),
    path: pathSchema.default('.'),
    maxResults: z.number().int().min(1).max(200).default(50),
  }),
  write_file: z.object({
    path: pathSchema,
    content: z.string().max(1_000_000),
  }),
  apply_patch: z.object({
    path: pathSchema,
    /**
     * texto exacto a sustituir. se exige coincidencia unica: si aparece varias
     * veces o ninguna, la herramienta falla en vez de adivinar.
     */
    find: z.string().min(1).max(100_000),
    replace: z.string().max(100_000),
  }),
  delete_file: z.object({ path: pathSchema }),
  git_status: z.object({}),
  // sin argumentos: el diff es siempre del worktree completo. Aceptar un path
  // y despues ignorarlo hacia que el modelo creyera que habia acotado la salida.
  git_diff: z.object({}),
  // el modelo elige CUAL de los comandos configurados ejecutar, nunca QUE
  // comando. Por eso el argumento es un indice, no una cadena.
  run_tests: z.object({ commandIndex: z.number().int().min(0).max(9).optional() }),
  run_lint: z.object({ commandIndex: z.number().int().min(0).max(9).optional() }),
  run_build: z.object({ commandIndex: z.number().int().min(0).max(9).optional() }),
} satisfies Record<AgentToolName, z.ZodTypeAny>;

export interface ToolDescription {
  name: AgentToolName;
  description: string;
  /** true si modifica archivos: exige allowEdits en el proyecto */
  mutating: boolean;
}

export const TOOL_DESCRIPTIONS: Record<AgentToolName, ToolDescription> = {
  list_files: {
    name: 'list_files',
    description: 'Lista archivos y carpetas de una ruta del proyecto.',
    mutating: false,
  },
  read_file: {
    name: 'read_file',
    description: 'Lee el contenido de un archivo del proyecto, opcionalmente por rango de lineas.',
    mutating: false,
  },
  search_files: {
    name: 'search_files',
    description: 'Busca archivos cuyo nombre coincida con un patron.',
    mutating: false,
  },
  search_text: {
    name: 'search_text',
    description: 'Busca un texto dentro de los archivos del proyecto.',
    mutating: false,
  },
  write_file: {
    name: 'write_file',
    description: 'Crea o sustituye por completo un archivo del proyecto.',
    mutating: true,
  },
  apply_patch: {
    name: 'apply_patch',
    description:
      'Sustituye un fragmento exacto dentro de un archivo. Falla si el fragmento no aparece exactamente una vez.',
    mutating: true,
  },
  delete_file: {
    name: 'delete_file',
    description: 'Borra un archivo del proyecto.',
    mutating: true,
  },
  git_status: {
    name: 'git_status',
    description: 'Muestra los archivos modificados en el worktree.',
    mutating: false,
  },
  git_diff: {
    name: 'git_diff',
    description: 'Muestra el diff de los cambios del worktree.',
    mutating: false,
  },
  run_tests: {
    name: 'run_tests',
    description:
      'Ejecuta uno de los comandos de prueba configurados para el proyecto. No admite comandos nuevos.',
    mutating: false,
  },
  // las tres ejecutan la MISMA lista de comandos configurados del proyecto:
  // ProjectConfig solo tiene testCommands. Se mantienen los tres nombres porque
  // ayudan al modelo a expresar su intencion, pero la descripcion no miente
  // sobre lo que hacen.
  run_lint: {
    name: 'run_lint',
    description:
      'Ejecuta uno de los comandos de comprobacion configurados para el proyecto (la misma lista que run_tests).',
    mutating: false,
  },
  run_build: {
    name: 'run_build',
    description:
      'Ejecuta uno de los comandos de comprobacion configurados para el proyecto (la misma lista que run_tests).',
    mutating: false,
  },
};

/** herramientas que modifican archivos */
export const MUTATING_TOOLS: readonly AgentToolName[] = AGENT_TOOL_NAMES.filter(
  (name) => TOOL_DESCRIPTIONS[name].mutating,
);

export function isToolName(value: string): value is AgentToolName {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(value);
}

/** esquema JSON de las herramientas, para el tool calling nativo de OpenAI */
export function toolsAsOpenAiSchema(allowed: readonly AgentToolName[]): unknown[] {
  return allowed.map((name) => ({
    type: 'function',
    function: {
      name,
      description: TOOL_DESCRIPTIONS[name].description,
      parameters: zodToJsonSchema(TOOL_SCHEMAS[name]),
    },
  }));
}

/**
 * conversion minima de zod a JSON Schema.
 *
 * se escribe a mano en vez de traer una dependencia: las formas que usan estas
 * herramientas son sencillas y controladas, y asi no se añade un paquete mas al
 * proceso que ejecuta codigo.
 */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
      properties[key] = zodToJsonSchema(value);
      if (!value.isOptional()) required.push(key);
    }
    return { type: 'object', properties, required, additionalProperties: false };
  }
  if (schema instanceof z.ZodDefault) {
    return zodToJsonSchema(schema._def.innerType as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema._def.innerType as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodString) return { type: 'string' };
  if (schema instanceof z.ZodNumber) return { type: 'integer' };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  return { type: 'string' };
}
