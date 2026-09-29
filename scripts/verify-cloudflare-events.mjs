import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * A passing SSR build is not proof that queue and scheduled callbacks made it
 * into the Nitro Cloudflare Worker. Fail deployment if the hooks were stripped.
 */
const root = ".output/server";
const markers = [
  "seramet-cloudflare-event-hooks:registered",
  "seramet-cloudflare-event-hooks:scheduled",
  "seramet-cloudflare-event-hooks:queue",
];
const found = new Set();

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await scan(path);
    } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
      const text = await readFile(path, "utf8");
      for (const marker of markers) {
        if (text.includes(marker)) found.add(marker);
      }
    }
  }
}

await scan(root);
const missing = markers.filter((marker) => !found.has(marker));
if (missing.length) {
  throw new Error(
    `Compiled Cloudflare Worker is missing Nitro Queue/Cron plugin markers: ${missing.join(", ")}`,
  );
}
console.info("Compiled Cloudflare Worker contains Seramet Queue and Cron hook registration.");
