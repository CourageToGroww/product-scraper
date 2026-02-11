import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src/client",
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/client")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000"
    }
  }
});
