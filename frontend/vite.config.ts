import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const backendUrl = process.env.VITE_API_URL
    ? `https://${process.env.VITE_API_URL}`
    : 'http://localhost:8000';

  return {
    plugins: [react()],
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
