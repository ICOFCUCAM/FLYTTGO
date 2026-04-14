import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        /* Manual chunk splitting. Without this, every third-party
         * package ends up in a single ~600 kB `index.js` chunk that
         * invalidates on every app-code change and wastes customer
         * bandwidth. Splitting by category gives us:
         *
         *   - react-vendor         ~140 kB — rarely changes
         *   - supabase-vendor      ~100 kB — rarely changes
         *   - i18n-vendor          ~50 kB  — rarely changes
         *   - ui-vendor            ~180 kB — rarely changes
         *   - index                ~100 kB — app code, changes on every deploy
         *
         * Returning customers keep the vendor chunks in browser cache
         * across deploys, so the "new version" download is smaller
         * and page loads are faster. */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          /* React core and hooks — changes very rarely. */
          if (id.includes('/react/')
              || id.includes('/react-dom/')
              || id.includes('/scheduler/')
              || id.includes('/react-router')) {
            return 'react-vendor';
          }

          /* Supabase client + its WebSocket/realtime deps. */
          if (id.includes('@supabase/')
              || id.includes('/postgrest-js/')
              || id.includes('/realtime-js/')) {
            return 'supabase-vendor';
          }

          /* i18n: react-i18next + i18next + language detector. */
          if (id.includes('/i18next')
              || id.includes('/react-i18next/')) {
            return 'i18n-vendor';
          }

          /* Radix UI + shadcn bits + lucide icons. Pretty chunky. */
          if (id.includes('@radix-ui/')
              || id.includes('/lucide-react/')
              || id.includes('/class-variance-authority/')
              || id.includes('/clsx/')
              || id.includes('/tailwind-merge/')) {
            return 'ui-vendor';
          }

          /* React Query — used across dashboards. */
          if (id.includes('@tanstack/')) {
            return 'query-vendor';
          }

          /* Everything else in node_modules ends up in a generic
           * 'vendor' bundle so we don't accidentally leave
           * anything uncategorised back in the main index chunk. */
          return 'vendor';
        },
      },
    },
    /* We've split the bundle, so the 500 kB warning threshold is
     * redundant — raise it slightly so the build isn't flagged for
     * non-actionable warnings. */
    chunkSizeWarningLimit: 800,
  },
}));
