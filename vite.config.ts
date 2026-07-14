import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig, normalizePath } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const require = createRequire(import.meta.url);
const pyodideRoot = dirname(require.resolve('pyodide/package.json'));
const pyodideAssetFiles = [
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'pyodide-lock.json',
  'python_stdlib.zip'
];
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
};

export default defineConfig({
  optimizeDeps: {
    exclude: ['pyodide']
  },
  plugins: [
    viteStaticCopy({
      targets: pyodideAssetFiles.map((fileName) => ({
        src: normalizePath(join(pyodideRoot, fileName)),
        dest: 'pyodide',
        rename: { stripBase: true }
      }))
    })
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    headers: crossOriginIsolationHeaders
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    headers: crossOriginIsolationHeaders
  }
});
