import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { sites } from "@openai/sites-vite-plugin";
import { defineConfig } from "vite";

const root = resolve(import.meta.dirname);
const clientOut = resolve(root, "dist", "client");
const screenshotEvidence = resolve(root, "src", "assets", "game-source");

function preserveVanillaClient() {
  return {
    name: "preserve-vanilla-client",
    async closeBundle() {
      await mkdir(clientOut, { recursive: true });
      await cp(resolve(root, "index.html"), resolve(clientOut, "index.html"));
      await rm(resolve(clientOut, "src"), { recursive: true, force: true });
      await cp(resolve(root, "src"), resolve(clientOut, "src"), {
        recursive: true,
        filter(source) {
          return resolve(source) !== screenshotEvidence;
        },
      });
    },
  };
}

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    publicDir: false,
    plugins: [sites(), preserveVanillaClient(), cloudflare({ viteEnvironment: { name: "server" } })],
  };
});
