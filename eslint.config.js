const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const eslintConfigPrettier = require('eslint-config-prettier');
const globals = require('globals');

module.exports = tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        project: 'tsconfig.json',
        sourceType: 'module',
      },
    },
  },
  {
    rules: {
      'no-return-await': 'off',
      'no-console': ['warn'],
      // The 'Config' singleton is undefined until ConfigService is constructed. Reading it in a
      // field initializer of a Nest-instantiated class (@Injectable/@Controller) crashes app
      // bootstrap when that provider is instantiated before ConfigService (provider ordering /
      // circular dependency). Scoped to those decorators so request DTOs/entities (built at
      // runtime, when Config is already set) are not affected. Use a getter or onModuleInit.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "ClassDeclaration:has(Decorator[expression.callee.name=/^(Injectable|Controller)$/]) PropertyDefinition[value] MemberExpression[object.name='Config']",
          message:
            "Do not read the 'Config' singleton in a field initializer of an @Injectable/@Controller class: Config is undefined until ConfigService is constructed, which crashes app bootstrap if this provider is instantiated first. Use a getter or read Config in onModuleInit instead.",
        },
      ],
      '@typescript-eslint/return-await': ['warn', 'in-try-catch'],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    ignores: ['eslint.config.js', 'migration/**/*.js', 'scripts/*.js', 'dist/**', 'node_modules/**'],
  },
);
