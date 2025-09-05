import { defineConfig } from 'vite';

export default defineConfig(() => ({
  define: {
    'process.env.APP_NAME': JSON.stringify(process.env.APP_NAME),
  },
}));
