import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'release/**',
      'node_modules/**',
      '.run/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'resources/icons/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,mjs,js}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2023 }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='eval']",
          message: 'eval() is forbidden by the Harborlight security policy.'
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message:
            'Dynamic Function() construction is forbidden by the Harborlight security policy.'
        }
      ],
      eqeqeq: ['error', 'smart'],
      'no-console': 'off'
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser }
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'The renderer must not import Electron directly.' },
            { name: 'dockerode', message: 'The renderer must not talk to Docker directly.' },
            { name: 'child_process', message: 'The renderer has no Node.js access.' },
            { name: 'node:child_process', message: 'The renderer has no Node.js access.' },
            { name: 'fs', message: 'The renderer has no Node.js access.' },
            { name: 'node:fs', message: 'The renderer has no Node.js access.' }
          ]
        }
      ]
    }
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  {
    files: ['scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off'
    }
  }
)
