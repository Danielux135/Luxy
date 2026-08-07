import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * empaquetado del preload de la ventana OCULTA de captura.
 *
 * POR QUE ES UN ARCHIVO APARTE Y NO OTRA ENTRADA DE electron.vite.config.ts:
 *
 * La configuracion de preload de electron-vite usa inlineDynamicImports, que
 * mete todo en un solo archivo. Eso es obligatorio con sandbox:true -en sandbox
 * no hay require de modulos propios- pero rollup NO puede inlinear con dos
 * entradas a la vez. Con dos entradas habria que renunciar al archivo unico y
 * los dos preloads dejarian de cargar.
 *
 * Asi que se construye por separado, igual que ya se hace con el proceso del
 * agente en vite.agent.config.ts.
 *
 * emptyOutDir: false es IMPRESCINDIBLE. Este build escribe en la misma carpeta
 * que el preload de la interfaz, que se genera antes; vaciarla lo borraria y la
 * ventana principal se quedaria sin window.luxy, es decir en blanco.
 */
export default defineConfig({
  build: {
    outDir: 'out/preload',
    emptyOutDir: false,
    ssr: true,
    minify: false,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/preload/capture.ts'),
      output: {
        // CommonJS por lo mismo que el otro preload: con sandbox:true se ejecuta
        // como javascript plano, sin contexto de modulos ES
        format: 'cjs',
        entryFileNames: 'capture.cjs',
        inlineDynamicImports: true,
      },
      external: ['electron'],
    },
  },
  ssr: { noExternal: true },
});
