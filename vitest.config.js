const { defineConfig } = require('vitest/config');
const path = require('path');

module.exports = defineConfig({
  test: {
    environment: 'jsdom',
    include: ['**/*.vitest.test.js'],
    setupFiles: [path.resolve(__dirname, 'tests/setup/vitest.setup.js')],
    coverage: {
      reporter: ['text', 'lcov'],
    },
  },
});
