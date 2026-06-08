import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import rootTailwind from './tailwind.config.js';

// Standalone library build for the embeddable checkout widget (embed.js).
// React/ReactDOM are aliased to preact/compat so the existing CheckoutForm
// component renders under Preact, keeping the self-contained bundle small. CSS
// is Tailwind, compiled against the public checkout components and inlined into
// each Shadow root (see embed/embed.tsx).
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
      'react-dom/test-utils': 'preact/test-utils',
    },
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss({
          ...rootTailwind,
          content: [
            path.resolve(__dirname, 'embed/**/*.{ts,tsx}'),
            path.resolve(__dirname, 'src/components/public/**/*.{ts,tsx}'),
            path.resolve(__dirname, 'src/components/ui/**/*.{ts,tsx}'),
          ],
        }),
        autoprefixer(),
      ],
    },
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'embed/embed.tsx'),
      name: 'CodAdminEmbed',
      formats: ['iife'],
      fileName: () => 'embed.js',
    },
    outDir: 'dist-embed',
    emptyOutDir: true,
    minify: 'terser',
    cssCodeSplit: false,
    sourcemap: false,
  },
});
