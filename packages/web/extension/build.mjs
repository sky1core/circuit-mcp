import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

const isWatch = process.argv.includes('--watch');

async function build() {
  // Ensure dist directory exists
  if (!existsSync('dist')) {
    mkdirSync('dist', { recursive: true });
  }

  const commonOptions = {
    bundle: true,
    format: 'esm',
    target: 'chrome120',
    sourcemap: true,
    minify: !isWatch,
  };

  // Build background script
  const bgContext = await esbuild.context({
    ...commonOptions,
    entryPoints: ['src/background.ts'],
    outfile: 'dist/background.js',
  });

  // Build popup script
  const popupContext = await esbuild.context({
    ...commonOptions,
    entryPoints: ['src/popup.ts'],
    outfile: 'dist/popup.js',
  });

  // Build content script (IIFE format, not ESM)
  const contentContext = await esbuild.context({
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    sourcemap: true,
    minify: !isWatch,
    entryPoints: ['src/content.ts'],
    outfile: 'dist/content.js',
  });

  // Build offscreen script
  const offscreenContext = await esbuild.context({
    ...commonOptions,
    entryPoints: ['src/offscreen.ts'],
    outfile: 'dist/offscreen.js',
  });

  if (isWatch) {
    console.log('Watching for changes...');
    await Promise.all([
      bgContext.watch(),
      popupContext.watch(),
      contentContext.watch(),
      offscreenContext.watch(),
    ]);
  } else {
    await Promise.all([
      bgContext.rebuild(),
      popupContext.rebuild(),
      contentContext.rebuild(),
      offscreenContext.rebuild(),
    ]);
    await Promise.all([
      bgContext.dispose(),
      popupContext.dispose(),
      contentContext.dispose(),
      offscreenContext.dispose(),
    ]);
    console.log('Build complete!');
  }
}

build().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
