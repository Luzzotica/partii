import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.resolve(dir, "..");

// public/ holds symlinks into the site asset folders. Follow them when
// copying into dist so a deploy does not ship broken links.
function dereferenceDistSymlinks(): Plugin {
  return {
    name: "dereference-dist-symlinks",
    closeBundle() {
      const dist = path.resolve(dir, "dist");
      const walk = (directory: string) => {
        for (const name of fs.readdirSync(directory)) {
          const full = path.join(directory, name);
          const stat = fs.lstatSync(full);
          if (stat.isSymbolicLink()) {
            const real = fs.realpathSync(full);
            fs.rmSync(full);
            fs.cpSync(real, full, { recursive: true, dereference: true });
          } else if (stat.isDirectory()) {
            walk(full);
          }
        }
      };
      if (fs.existsSync(dist)) walk(dist);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), dereferenceDistSymlinks()],
  resolve: {
    alias: {
      // Game components import the Next site. Point those at standalone shims.
      "@": path.resolve(dir, "shims"),
      react: path.resolve(dir, "node_modules/react"),
      "react-dom": path.resolve(dir, "node_modules/react-dom"),
      phaser: path.resolve(dir, "node_modules/phaser"),
      zustand: path.resolve(dir, "node_modules/zustand"),
    },
    dedupe: ["react", "react-dom", "phaser", "zustand"],
  },
  server: {
    host: "0.0.0.0",
    port: 5174,
    fs: { allow: [gameDir] },
  },
  preview: { host: "0.0.0.0", port: 4174 },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
