import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // relative paths, so the build works under https://<user>.github.io/osmCorrection/
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    // osmValidation and osmAssist are git submodules; use their TypeScript sources directly
    alias: [
      { find: /^osmvalidation$/, replacement: fileURLToPath(new URL('./libs/osmValidation/src/index.ts', import.meta.url)) },
      { find: /^osmassist$/, replacement: fileURLToPath(new URL('./libs/osmAssist/src/index.ts', import.meta.url)) },
      // the Claude client with the SDK, loaded only when the AI is used
      { find: /^osmassist\/claude$/, replacement: fileURLToPath(new URL('./libs/osmAssist/src/claude.ts', import.meta.url)) },
    ],
  },
  server: {
    // OSM only accepts http redirect URIs for 127.0.0.1
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
