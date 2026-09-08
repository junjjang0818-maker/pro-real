import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Web demo bundler. Vitest keeps its own `vitest.config.ts`, so the unit-test
// setup is unaffected by anything here.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@app': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 5173, host: true },
  build: { outDir: 'dist', sourcemap: true },
});
