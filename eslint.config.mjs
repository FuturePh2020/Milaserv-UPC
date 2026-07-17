// Root ESLint flat config for all workspaces (API, Web, packages).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      '**/jest.config.js',
      'Dashboard.jsx',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // NestJS DI relies on emitDecoratorMetadata: classes referenced in
    // constructor/parameter positions must stay VALUE imports or their
    // design:paramtypes metadata degrades to Object and injection (and
    // ValidationPipe DTO validation) silently breaks. Without type-aware
    // linting the rule cannot see that, so it is disabled for API sources.
    files: ['apps/api/src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
);
