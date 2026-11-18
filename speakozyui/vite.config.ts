import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [
      "3000-i4bdpdg5df0xn2scsecy0-324fbadc.sg2.manus.computer",
      ".sg2.manus.computer"
    ]
  },
  build: {
    rollupOptions: {
      input: {
        index: new URL("index.html", import.meta.url).pathname,
        login: new URL("login.html", import.meta.url).pathname,
        system: new URL("system-preview.html", import.meta.url).pathname
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/firebase") || id.includes("node_modules/@firebase")) return "firebase";
          if (id.includes("node_modules/react") || id.includes("node_modules/lucide-react")) return "ui-vendor";
        }
      }
    }
  },
  resolve: {
    alias: {
      "@": root + "src"
    }
  }
});
