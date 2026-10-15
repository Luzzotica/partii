import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The commit the site was built from (Vercel sets it): the site's version on partii's own analytics.
const commit = ((globalThis as any).process?.env?.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 7);

export default defineConfig({ plugins: [react()], server: { port: 5190 }, define: { __COMMIT__: JSON.stringify(commit) } });
