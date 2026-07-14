import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/dashboard/',
  root: __dirname,
  build: {
    outDir: '../../dist/console',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/v1': 'http://localhost:3000',
    },
  },
});
