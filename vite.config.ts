import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(env['PORT'] ?? 5173),
      strictPort: true,
    },
    preview: {
      port: Number(env['PREVIEW_PORT'] ?? env['PORT'] ?? 5173),
      strictPort: true,
    },
  };
});
