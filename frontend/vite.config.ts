import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      // Enable Fast Refresh
      fastRefresh: true,
    }),
    // PWA disabled — the service worker cached index.html with X-Frame-Options
    // headers which blocked iframe embedding of checkout forms on external sites.
    // Keep manifest-only for mobile home screen support, no service worker.
    VitePWA({
      selfDestroying: true,
      includeAssets: ['vite.svg', 'icons/*.png'],
      manifest: {
        name: 'COD Admin Pro',
        short_name: 'COD Admin',
        description: 'COD Admin Pro - E-commerce management dashboard',
        theme_color: '#1e3a5f',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/icon-maskable-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/icon-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Build optimizations
    target: 'esnext',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console.logs in production
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching
        manualChunks: {
          // Vendor chunks
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': ['zustand', 'react-hook-form', '@hookform/resolvers', 'zod'],
          'chart-vendor': ['recharts'],
          'dnd-vendor': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          'workflow-vendor': ['reactflow'],
          'utils-vendor': ['axios', 'date-fns', 'clsx', 'tailwind-merge'],
        },
        // Optimize chunk naming
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },
    // Increase chunk size warning limit (in kB)
    chunkSizeWarningLimit: 1000,
    // Enable CSS code splitting
    cssCodeSplit: true,
    // Generate source maps for production debugging (optional, disable for smaller builds)
    sourcemap: false,
    // Optimize dependencies
    commonjsOptions: {
      include: [/node_modules/],
    },
  },
  optimizeDeps: {
    // Pre-bundle dependencies for faster dev server startup
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      'zustand',
      'axios',
      'react-hook-form',
      '@hookform/resolvers',
      'zod',
      'react-hot-toast',
      'date-fns',
      'clsx',
      'tailwind-merge',
      'recharts', // Include recharts to handle lodash compatibility
    ],
    // Exclude large dependencies that should be lazy loaded
    exclude: ['reactflow'],
  },
  // Performance hints
  esbuild: {
    logOverride: { 'this-is-undefined-in-esm': 'silent' },
  },
})
