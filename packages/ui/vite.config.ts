import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/* React and lucide-react are the consumer's copies, never ours: bundling either would
   duplicate the runtime in every app that installs the library. */
const EXTERNAL = new Set(['react', 'react-dom', 'lucide-react']);
const EXTERNAL_PREFIXES = ['react/', 'react-dom/', 'lucide-react/'];

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
    emptyOutDir: true,
    // One stylesheet for the whole library, in the order src/styles/index.css declares.
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'index',
      cssFileName: 'styles',
    },
    rollupOptions: {
      external: (id) =>
        EXTERNAL.has(id) || EXTERNAL_PREFIXES.some((prefix) => id.startsWith(prefix)),
    },
  },
});
