import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/* React and lucide-react are the consumer's copies, never ours: bundling either would
   duplicate the runtime in every app that installs the library. */
const EXTERNAL = new Set(['react', 'react-dom', 'lucide-react']);
const EXTERNAL_PREFIXES = ['react/', 'react-dom/', 'lucide-react/'];

const FONT_DIR = fileURLToPath(new URL('./src/assets/fonts', import.meta.url));

/** The directory name tokens/fonts.css points `url()` at, relative to the stylesheet. */
const FONT_OUT_DIR = 'fonts';

/**
 * Ship the font binaries as real files next to the stylesheet.
 *
 * Vite's library mode base64-inlines every asset a stylesheet resolves, and no setting
 * turns that off (`assetsInlineLimit` is ignored once `build.lib` is set). Inlining these
 * five variable faces produced a 1,063 kB stylesheet, 778 kB gzipped: render-blocking,
 * impossible to cache separately, and it defeats `font-display: swap` outright, because a
 * face cannot swap in late if it *is* the stylesheet.
 *
 * So tokens/fonts.css deliberately points at `./fonts/...`, which does not exist next to
 * the source stylesheet. Vite leaves a url() it cannot resolve exactly as written, and this
 * plugin puts the real files at that path in dist. The result is one stylesheet that a
 * bundler resolves normally from inside node_modules, with the fonts as separate, cacheable,
 * swappable requests.
 *
 * The OFL licence files are emitted alongside the binaries on purpose: under the SIL Open
 * Font License the licence has to travel with the fonts it covers, so shipping the woff2
 * without the OFL.txt beside it would be a licence violation.
 */
function vendorFonts(): Plugin {
  /* Where the stylesheet itself lands differs by build: the library build writes it to the
     root of dist, Storybook writes it under its assets directory. `./fonts/...` is relative
     to the stylesheet, so the fonts have to follow it rather than sit at a fixed path, or
     the workshop reviews every component in a fallback face. */
  let outDir = FONT_OUT_DIR;

  return {
    name: 'openrunic:vendor-fonts',
    configResolved(config) {
      outDir = config.build.lib
        ? FONT_OUT_DIR
        : `${config.build.assetsDir}/${FONT_OUT_DIR}`.replace(/^\/+/, '');
    },
    generateBundle() {
      for (const name of readdirSync(FONT_DIR)) {
        this.emitFile({
          type: 'asset',
          fileName: `${outDir}/${name}`,
          source: readFileSync(`${FONT_DIR}/${name}`),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), vendorFonts()],
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
