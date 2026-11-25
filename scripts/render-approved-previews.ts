// Renders the approved KOT, BOT, invoice and receipt (reference sample data)
// into docs/print-previews/approved/ as PNG, exactly as an image-mode printer
// prints them: the same renderRichForProfile bitmap the bridge sends.
//   npx vite-node scripts/render-approved-previews.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderRichForProfile } from "../printing-core/rich-render.mjs";
import { approvedReferenceSamples } from "./approved-reference-samples";
import { bitmapToPng } from "./bitmap-png";

const DOTS = { "80mm": 576, "58mm": 384 } as const;

const out = join(process.cwd(), "docs", "print-previews", "approved");
mkdirSync(out, { recursive: true });
for (const paper of ["80mm", "58mm"] as const) {
  for (const { name, job } of approvedReferenceSamples(paper)) {
    if (!job.rich) throw new Error(`${name} has no typeset form`);
    const bitmap = renderRichForProfile(job.rich, { printableWidthDots: DOTS[paper], dpi: 203 });
    writeFileSync(join(out, `${name}-${paper}.png`), bitmapToPng(bitmap));
    writeFileSync(join(out, `${name}-${paper}.txt`), `${job.content}\n`);
  }
}
console.log(`Wrote approved previews to ${out}`);
