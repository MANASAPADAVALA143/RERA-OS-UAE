import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  const backendUrl = process.env.VITE_API_URL
    ? `https://${process.env.VITE_API_URL}`
    : 'http://localhost:8000';

  return {
    plugins: [react()],
    build: {
      // The ported Property Dev / Consultancy financial-statement engine
      // (utils/finItemYearUtils.ts — ~6.5k lines, ~130 exports) sends Rollup's
      // tree-shaking pass into a non-terminating analysis on this module graph.
      // Disabling tree-shaking is the only setting that builds; the cost is a
      // larger bundle (acceptable for this internal MIS). Revisit with route-
      // level code-splitting if bundle size becomes a concern.
      rollupOptions: { treeshake: false },
      chunkSizeWarningLimit: 6000,
    },
    server: {
      port: 5173,
      proxy: {
        '/api':     backendUrl,
        '/health':  backendUrl,
        '/uploads': backendUrl,
      },
    },
  };
});
