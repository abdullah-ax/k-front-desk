/**
 * Inlines src/server/app.html into a TypeScript module.
 *
 * The platform HTML is served from the request handler rather than as a static
 * file, so that the passphrase gate cannot be routed around by the host's
 * static file handling. That means it has to survive bundling, and a
 * `readFileSync` of a `.html` next to the source does not: the deploy target
 * bundles the function and the file is simply absent at runtime. So it becomes
 * a string constant at build time, and the HTML stays editable on its own.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/config.js";

const source = join(ROOT, "src", "server", "app.html");
const target = join(ROOT, "src", "server", "app-html.ts");

const html = readFileSync(source, "utf8");
const escaped = html.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

writeFileSync(
  target,
  `/**\n` +
    ` * GENERATED FILE. Edit src/server/app.html and run \`pnpm build:app\`.\n` +
    ` */\n` +
    `export const APP_HTML = \`${escaped}\`;\n`,
);

console.log(`  app-html.ts written: ${(html.length / 1024).toFixed(1)} kB of HTML`);
