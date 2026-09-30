import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset URLs so dist/ can be hosted under any sub-path (e.g. gh-pages)
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    // three.js alone is ~600 kB minified; one chunk is fine for a single-page game
    chunkSizeWarningLimit: 1000,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'server/**/*.test.mjs'],
  },
});
