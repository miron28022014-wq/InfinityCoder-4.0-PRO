import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api is proxied to the local terminal bridge (`npm run bridge`) so the browser
// build of InfinityCoder can execute REAL shell commands.
export default defineConfig({
  plugins: [react()],
  // Tauri serves the app from a custom protocol, so assets must be relative.
  base: "./",
  build: {
    target: "es2021",
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2400,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          // Syntax highlighting pulls in a dozen language packages; keeping
          // them apart lets the shell paint before the editor is parsed.
          codemirror: [
            "@codemirror/view",
            "@codemirror/state",
            "@codemirror/language",
            "@codemirror/lang-javascript",
            "@codemirror/lang-python",
            "@codemirror/lang-rust"
          ]
        }
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:5299", changeOrigin: true }
    }
  }
});
