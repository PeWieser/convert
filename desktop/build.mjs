import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
await mkdir('build', { recursive: true });
await build({ entryPoints: ['main.ts', 'preload.ts'], bundle: true, platform: 'node', format: 'cjs', outdir: 'build', outExtension: { '.js': '.cjs' }, external: ['electron'], target: 'node22' });
await cp('../dist', 'build/renderer', { recursive: true });

await cp("assets/wandler.png", "build/wandler.png");
