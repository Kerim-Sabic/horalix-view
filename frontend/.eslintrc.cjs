module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'coverage', 'node_modules'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['react-refresh', 'simple-import-sort', 'unused-imports', 'import'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true, allowExportNames: ['useAuth', 'useTheme'] },
    ],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/ban-ts-comment': [
      'warn',
      {
        'ts-ignore': true,
        'ts-nocheck': true,
        'ts-check': true,
        'ts-expect-error': 'allow-with-description',
      },
    ],
    'unused-imports/no-unused-imports': 'error',
  },
  overrides: [
    {
      files: ['src/features/viewer/domain/**/*.{ts,tsx}'],
      rules: {
        'simple-import-sort/imports': 'error',
        'simple-import-sort/exports': 'error',
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              '../app/*',
              '../infra/*',
              '../ui/*',
              '../components/*',
              '@/features/viewer/app/*',
              '@/features/viewer/infra/*',
              '@/features/viewer/ui/*',
              '@/features/viewer/components/*',
            ],
          },
        ],
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/ban-ts-comment': [
          'error',
          {
            'ts-ignore': true,
            'ts-nocheck': true,
            'ts-check': true,
            'ts-expect-error': 'allow-with-description',
          },
        ],
        'max-depth': ['error', 3],
        'complexity': ['error', 12],
        'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      },
    },
    {
      files: [
        'src/features/viewer/app/**/*.{ts,tsx}',
        'src/features/viewer/infra/**/*.{ts,tsx}',
        'src/features/viewer/ui/**/*.{ts,tsx}',
      ],
      rules: {
        'simple-import-sort/imports': 'error',
        'simple-import-sort/exports': 'error',
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/ban-ts-comment': [
          'error',
          {
            'ts-ignore': true,
            'ts-nocheck': true,
            'ts-check': true,
            'ts-expect-error': 'allow-with-description',
          },
        ],
        'max-depth': ['error', 3],
        'complexity': ['error', 12],
        'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      },
    },
    {
      files: ['src/features/viewer/app/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              '../ui/*',
              '@/features/viewer/ui/*',
            ],
          },
        ],
      },
    },
    {
      files: ['src/features/viewer/ui/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              '../infra/*',
              '@/features/viewer/infra/*',
            ],
          },
        ],
      },
    },
    {
      // Allow hooks to be exported from context files
      files: ['**/contexts/**/*.tsx', '**/themes/**/*.tsx'],
      rules: {
        'react-refresh/only-export-components': 'off',
      },
    },
  ],
};
