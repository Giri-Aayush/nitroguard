import { defineConfig } from 'tsup';

export default defineConfig([
  // Main package entry
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['viem', '@erc7824/nitrolite', 'react', 'react-dom', 'zod', 'level'],
    treeshake: true,
    outDir: 'dist',
  },
  // React subpath export
  {
    entry: { 'react/index': 'src/react/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    external: ['viem', '@erc7824/nitrolite', 'react', 'react-dom', 'zod'],
    treeshake: true,
    outDir: 'dist',
  },
]);
