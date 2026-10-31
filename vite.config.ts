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
    alias: {
      // osmValidation is a git submodule; use its TypeScript sources directly
      osmvalidation: fileURLToPath(new URL('./libs/osmValidation/src/index.ts', import.meta.url)),
    },
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
