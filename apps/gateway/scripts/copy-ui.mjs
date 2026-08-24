import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "../src/ui");
const dest = join(root, "../dist/ui");
mkdirSync(dest, { recursive: true });
for (const name of ["app.css", "app.js", "landing.css", "demo.css", "demo.js"]) {
  copyFileSync(join(src, name), join(dest, name));
}
const fonts = join(src, "fonts");
if (existsSync(fonts)) {
  cpSync(fonts, join(dest, "fonts"), { recursive: true });
}
