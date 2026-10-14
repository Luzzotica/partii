import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.resolve(dir, "..");
const sdkDir = path.resolve(dir, "../../../../platform/sdk/ts");

/** Publishable staging key only. The developer token in that file stays out of the bundle. */
function partiiPublic(): { api: string; key: string } {
  const file = path.join(os.homedir(), ".config/partii/rocket-to-heaven-game.env");
  if (!fs.existsSync(file)) {
    throw new Error("Missing ~/.config/partii/rocket-to-heaven-game.env");
  }
  const text = fs.readFileSync(file, "utf8");
  const pick = (name: string) => {
    const line = text.split("\n").find((entry) => entry.startsWith(`${name}=`));
    if (!line) throw new Error(`Missing ${name} in rocket-to-heaven-game.env`);
    return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
  };
  return { api: pick("PARTII_API"), key: pick("PARTII_KEY") };
}

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

export default defineConfig(() => {
  const partii = partiiPublic();
  return {
  define: {
    __PARTII_API__: JSON.stringify(partii.api),
    __PARTII_KEY__: JSON.stringify(partii.key),
  },
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
    fs: { allow: [gameDir, sdkDir] },
  },
  preview: { host: "0.0.0.0", port: 4174 },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  };
});
