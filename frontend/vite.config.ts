import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

// Plain client-side React app (no SSR). The router plugin must come before react().
export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // Must match FRONTEND_URL in the backend .env (the CORS origin).
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: ["solaris-malawi.onrender.com"],
  },
});
