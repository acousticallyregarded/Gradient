// Builds a single self-contained HTML file (stub engine only, no server) into demo-dist/.
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".");
const out = await build({
  entryPoints: ["demo/entry.tsx"],
  bundle: true,
  minify: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  alias: { "@": root },
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = out.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const css = readFileSync("app/globals.css", "utf8");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gradient</title>
<style>${css}</style></head>
<body><div id="root"></div>
<script>window.__GRADIENT_STATIC__=true</script>
<script>${js}</script></body></html>`;
mkdirSync("demo-dist", { recursive: true });
writeFileSync("demo-dist/gradient.html", html);
// Fragment variant for hosts that wrap the page in their own document skeleton (e.g. Claude artifacts).
const fragment = `<title>Gradient</title>
<style>${css}</style>
<div id="root"></div>
<script>window.__GRADIENT_STATIC__=true;window.__GRADIENT_EMBED__=true</script>
<script>${js}</script>`;
writeFileSync("demo-dist/gradient-embed.html", fragment);
console.log("demo-dist/gradient.html", (html.length / 1024).toFixed(0) + "KB");
