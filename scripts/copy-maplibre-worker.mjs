// MapLibre GL runs in a Web Worker and works out the worker's URL from
// import.meta.url. Under Next's bundler that points at a chunk path, so the
// worker never loads and the map draws nothing. We serve the worker ourselves
// from /public and tell MapLibre where it is (see src/lib/geo/map-style.ts).
//
// Runs before `dev` and `build` (package.json) so the copy always matches the
// installed maplibre-gl version. The copy is gitignored.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";

const source = resolve("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");
const target = resolve("public/maplibre-gl-worker.mjs");

try {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  console.log("copied maplibre-gl worker to public/maplibre-gl-worker.mjs");
} catch (error) {
  console.error(
    `Could not copy the MapLibre worker (${error.code ?? error.message}). Run npm install first.`,
  );
  process.exit(1);
}
