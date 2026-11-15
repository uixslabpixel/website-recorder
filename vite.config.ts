import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the build can be hosted from any static path.
  base: './',
  plugins: [react()],
});
