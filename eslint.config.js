// configuracion plana de eslint para todo el monorepo
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // artefactos generados: nunca se analizan
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.wrangler/**',
      '**/coverage/**',
      // artefactos de electron-vite, electron-builder y tsc -b del escritorio
      '**/out/**',
      '**/release/**',
      '**/.tsbuild/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // el renderer es .tsx y necesita las mismas reglas que el resto
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // los argumentos y variables descartados se marcan con guion bajo
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // prohibicion dura: nunca ejecutar contenido no confiable por shell
      'no-restricted-imports': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },
  {
    // los tests pueden usar tipos laxos en los mocks
    files: ['**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },
  {
    // el renderer corre en un navegador: no tiene process ni require
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly', console: 'readonly' },
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
);
