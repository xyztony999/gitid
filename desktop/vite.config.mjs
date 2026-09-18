import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'renderer',
  plugins: [vue()],
  base: './',
  build: {
    outDir: '../renderer-dist',
    emptyOutDir: true,
  },
});
