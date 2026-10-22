import { FONT } from "./font-5x8.mjs";
import { rasterMetrics, validateRenderJob } from "../printing-core/thermal-layout.mjs";
import { encodeEscPos } from "./escpos-encoder.mjs";

// Bounded bands, never a full-page pixel allocation. Adjacent GS v 0 bands
// contain no text line-feed commands, so table borders meet across band seams.
export function* rasterBands(layout, profile) {
  const m = rasterMetrics(layout, profile);
  const width = profile.raster.printableWidthDots;
  const cell = Math.floor(width / layout.columns);
  const margin = Math.floor((width - cell * layout.columns) / 2);
  const sx = Math.max(1, Math.floor((cell - 2) / 5));
  const sy = Math.max(1, Math.floor((m.lineHeight - 4) / 8));
  const columnX = (c) => margin + c * cell + Math.floor(cell / 2);
  for (let start = 0; start < m.height; start += profile.raster.maxBandHeight) {
    const height = Math.min(profile.raster.maxBandHeight, m.height - start);
    const data = Buffer.alloc(m.stride * height);
    const pixel = (x, y) => {
      if (x >= 0 && x < width && y >= start && y < start + height)
        data[(y - start) * m.stride + (x >> 3)] |= 0x80 >> (x & 7);
    };
    let y = 0;
    for (const [i, row] of layout.rows.entries()) {
      const rowHeight = m.heights[i];
      if (y < start + height && y + rowHeight > start) {
        if (row.kind === "rule") {
          for (let x = columnX(0); x <= columnX(row.text.length - 1); x++)
            for (let dy = 0; dy < rowHeight; dy++) pixel(x, y + dy);
        } else {
          for (const c of row.borders)
            for (let dy = 0; dy < rowHeight; dy++) pixel(columnX(c), y + dy);
          for (const [c, char] of [...row.text].entries()) {
            if (row.borders.includes(c)) continue;
            const code = Math.max(32, Math.min(126, char.charCodeAt(0))) - 32;
            for (let gx = 0; gx < 5; gx++)
              for (let gy = 0; gy < 8; gy++) {
                if (!(FONT[code * 5 + gx] & (1 << gy))) continue;
                for (let dx = 0; dx < sx + (row.strong && profile.emphasis ? 1 : 0); dx++)
                  for (let dy = 0; dy < sy; dy++)
                    pixel(margin + c * cell + 1 + gx * sx + dx, y + 2 + gy * sy + dy);
              }
          }
        }
      }
      y += rowHeight;
    }
    yield { width, height, start, data };
  }
}
export function encodePrintDocument(job, profile = job.profile) {
  validateRenderJob(job);
  if (profile.renderingMode !== "RASTER_ESC_POS") return encodeEscPos(job.content, profile);
  const chunks = [Buffer.from([27, 64, 27, 97, 0])];
  for (const b of rasterBands(job.document, profile)) {
    const stride = b.width / 8;
    chunks.push(
      Buffer.from([29, 118, 48, 0, stride & 255, stride >> 8, b.height & 255, b.height >> 8]),
      b.data,
    );
  }
  chunks.push(Buffer.from([27, 100, 3]));
  if (profile.cutter !== "none")
    chunks.push(Buffer.from([29, 86, profile.cutter === "partial" ? 1 : 0]));
  return Buffer.concat(chunks);
}
