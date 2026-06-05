import js from '@eslint/js';
    import globals from 'globals';
    
    export default [
      js.configs.recommended,
      {
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: 'module',
          globals: {
            ...globals.browser,
            ...globals.node,
          },
        },
        rules: {
          'no-unused-vars': ['warn', {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
          }],
          'no-console': 'off',
          'no-empty': ['error', { allowEmptyCatch: true }],
          'no-prototype-builtins': 'off',
          'no-inner-declarations': 'off',
          'no-constant-condition': ['error', { checkLoops: false }],
        },
      },
      {
        ignores: [
          'node_modules/**',
          'dist/**',
          'icons/**',
          'screenshots/**',
          'src/marked.min.js',
          'sw.js',
        ],
      },
    ];