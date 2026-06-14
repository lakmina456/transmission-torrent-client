import * as esbuild from 'esbuild';
import * as process from 'node:process';
import { sassPlugin } from 'esbuild-sass-plugin';

const ctx = await esbuild.context({
  bundle: true,
  entryPoints: ['./src/main.js'],
  legalComments: 'external',
  loader: {
    '.png': 'dataurl',
    '.svg': 'dataurl',
  },
  minify: true,
  outfile: './public_html/transmission-app.js',
  plugins: [sassPlugin()],
  sourcemap: true,
});

const watch = process.argv.includes('--watch') || process.env.DEV;

if (watch) {
  await ctx.watch();
  console.log('watching...');
} else {
  await ctx.rebuild();
  ctx.dispose();
}
