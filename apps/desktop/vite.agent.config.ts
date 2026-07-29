import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * empaquetado del proceso del agente.
 *
 * POR QUE EXISTE ESTE ARCHIVO. El agente se copiaba a resources/agent tal cual
 * salia de tsc, con sus imports de "@luxy/shared" y "zod" sin resolver. Dentro
 * del repositorio eso funciona de casualidad, porque node sube el arbol de
 * directorios y encuentra el node_modules del monorepo. Instalado en
 * %LOCALAPPDATA%\Programs\Luxy no hay ningun node_modules encima, asi que el
 * proceso moria con ERR_MODULE_NOT_FOUND antes incluso de crear el logger: de
 * ahi el "codigo 1" sin ninguna linea que explicara la causa.
 *
 * Aqui se genera UN SOLO archivo con todo dentro. Lo unico externo son los
 * modulos de node, que siempre estan.
 */
export default defineConfig({
  build: {
    outDir: 'out/agent',
    emptyOutDir: true,
    ssr: true,
    target: 'node20',
    minify: false,
    // el proceso hijo se lanza con utilityProcess.fork, que necesita un archivo
    // real en disco: por eso sale fuera del asar como extraResources
    rollupOptions: {
      input: resolve(import.meta.dirname, '../agent/src/runtime/host-entry.ts'),
      output: {
        format: 'es',
        entryFileNames: 'host-entry.js',
        inlineDynamicImports: true,
      },
      external: [/^node:/],
    },
  },
  // todo dentro del bundle: nada que resolver en tiempo de ejecucion
  ssr: { noExternal: true },
});
