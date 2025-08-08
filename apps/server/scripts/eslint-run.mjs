// apps/server/scripts/eslint-run.mjs
import { ESLint } from 'eslint';

const eslint = new ESLint({
  useEslintrc: false,
  baseConfig: {
    env: { node: true, es2022: true },
    extends: ['eslint:recommended'],
    parserOptions: { sourceType: 'module', ecmaVersion: 'latest' },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': 'off'
    }
  }
});

const results = await eslint.lintFiles(['src/**/*.js']);
const formatter = await eslint.loadFormatter('stylish');
const resultText = formatter.format(results);

console.log(resultText);
const errorCount = results.reduce((a, r) => a + r.errorCount, 0);
process.exit(errorCount ? 1 : 0);
