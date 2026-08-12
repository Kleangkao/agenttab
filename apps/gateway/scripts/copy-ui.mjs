import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "../src/ui");
const dest = join(root, "../dist/ui");
mkdirSync(dest, { recursive: true });
for (const name of ["app.css", "app.js"]) {
  copyFileSync(join(src, name), join(dest, name));
}
