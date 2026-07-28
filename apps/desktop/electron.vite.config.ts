import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * el main sale como ESM, coherente con el resto del monorepo. Comprobado
 * arrancando la aplicacion de verdad con Electron 43.
 *
 * EL PRELOAD, EN CAMBIO, TIENE QUE SER CommonJS: con sandbox:true se ejecuta
 * como javascript plano, sin contexto de modulos ES. Ademas debe ser un unico
 * archivo, porque en sandbox no hay require de modulos propios; de ahi
 * inlineDynamicImports.
 *
 * NOTA PARA QUIEN DEPURE ESTO: si al lanzar electron.exe aparece
 * "does not provide an export named 'BrowserWindow'" o app llega undefined,
 * comprueba ELECTRON_RUN_AS_NODE en el entorno. Con esa variable puesta (la
 * exportan VS Code y otros hosts) electron.exe se comporta como node puro y
 * require('electron') devuelve la ruta del binario en vez de la API. No es un
 * problema del bundle.
 *
 * los paquetes del workspace se meten dentro del bundle (noExternal) para que
 * electron-builder no tenga que resolver node_modules hoisted, que es la causa
 * conocida de fallos al empaquetar monorepos.
 */
export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: resolve(import.meta.dirname, 'src/main/index.ts'),
        output: { format: 'es', entryFileNames: 'index.js', inlineDynamicImports: true },
      },
    },
    // @luxy/agent tambien va dentro: el main usa su deteccion de herramientas y
    // su cliente del gateway, y dentro del asar no habria node_modules que
    // resolver
    resolve: { noExternal: ['@luxy/shared', '@luxy/agent', 'zod'] },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: resolve(import.meta.dirname, 'src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs', inlineDynamicImports: true },
      },
    },
    resolve: { noExternal: ['@luxy/shared', 'zod'] },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: resolve(import.meta.dirname, 'src/renderer/index.html') },
    },
    resolve: { noExternal: ['@luxy/shared', 'zod'] },
  },
});
