import * as esbuild from 'esbuild';

const entries = {
  background: 'src/background.ts',
  offscreen: 'src/offscreen.ts',
  sidepanel: 'src/sidepanel.ts',
  options: 'src/options.ts',
  'content-meet': 'src/content/meet.ts',
  'content-zoom': 'src/content/zoom.ts',
};

const ctx = await esbuild.context({
  entryPoints: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, v])),
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  sourcemap: 'inline',
  logLevel: 'info',
});

if (process.argv.includes('--watch')) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
