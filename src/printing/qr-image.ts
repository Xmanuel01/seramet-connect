// Turns a QR code image (a PNG, as Safaricom's Daraja Dynamic QR API returns
// it) back into its module grid, so the printer draws the exact code Safaricom
// issued, sharp at the printer's own resolution. Nothing is re-encoded: every
// module comes from the image, and an image that does not read as a clean QR
// symbol is rejected rather than guessed at.

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

type Gray = { width: number; height: number; dark: (x: number, y: number) => boolean };

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Decodes a non-interlaced PNG into a dark/light test per pixel. */
export async function decodePng(bytes: Uint8Array): Promise<Gray> {
  if (bytes.length < 33 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b))
    throw new Error("QR_IMAGE_NOT_PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      depth = body[8]!;
      colour = body[9]!;
      if (body[12] !== 0) throw new Error("QR_IMAGE_INTERLACED");
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!width || !height || width > 4000 || height > 4000) throw new Error("QR_IMAGE_SIZE");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colour as 0 | 2 | 3 | 4 | 6];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) throw new Error("QR_IMAGE_FORMAT");
  const compressed = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of idat) {
    compressed.set(part, at);
    at += part.length;
  }
  const raw = await inflate(compressed);
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < (stride + 1) * height) throw new Error("QR_IMAGE_TRUNCATED");
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? pixels[y * stride + i - bpp]! : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + i]! : 0;
      const c = y > 0 && i >= bpp ? pixels[(y - 1) * stride + i - bpp]! : 0;
      const x = line[i]!;
      let value: number;
      if (filter === 0) value = x;
      else if (filter === 1) value = x + a;
      else if (filter === 2) value = x + b;
      else if (filter === 3) value = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error("QR_IMAGE_FILTER");
      pixels[y * stride + i] = value & 255;
    }
  }
  const sample = (x: number, y: number, channel: number) => {
    if (depth === 8) return pixels[y * stride + x * channels + channel]!;
    if (depth === 16) return pixels[y * stride + (x * channels + channel) * 2]!;
    const bit = x * depth;
    const byte = pixels[y * stride + (bit >> 3)]!;
    const value = (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return colour === 3 ? value : Math.round((value * 255) / ((1 << depth) - 1));
  };
  const dark = (x: number, y: number) => {
    let r: number;
    let g: number;
    let b: number;
    let alpha = 255;
    if (colour === 3) {
      const index = sample(x, y, 0);
      if (!palette || index * 3 + 2 >= palette.length) throw new Error("QR_IMAGE_PALETTE");
      [r, g, b] = [palette[index * 3]!, palette[index * 3 + 1]!, palette[index * 3 + 2]!];
      if (transparency && index < transparency.length) alpha = transparency[index]!;
    } else if (colour === 0 || colour === 4) {
      r = g = b = sample(x, y, 0);
      if (colour === 4) alpha = sample(x, y, 1);
    } else {
      [r, g, b] = [sample(x, y, 0), sample(x, y, 1), sample(x, y, 2)];
      if (colour === 6) alpha = sample(x, y, 3);
    }
    // Transparent pixels sit on white paper.
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) * (alpha / 255) + 255 * (1 - alpha / 255);
    return luminance < 128;
  };
  return { width, height, dark };
}

const FINDER = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];

/**
 * The module grid of the QR symbol in the image, as rows of "0"/"1". Throws
 * when the image is not a clean, axis-aligned QR symbol with all three finder
 * patterns in place.
 */
export function modulesFromImage(image: Gray): string[] {
  let left = image.width;
  let right = -1;
  let top = image.height;
  let bottom = -1;
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++)
      if (image.dark(x, y)) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (right < 0) throw new Error("QR_IMAGE_BLANK");
  const width = right - left + 1;
  const height = bottom - top + 1;
  if (Math.abs(width - height) > Math.max(2, width * 0.02)) throw new Error("QR_IMAGE_NOT_SQUARE");
  // The top row of the top-left finder pattern is 7 modules of solid ink,
  // which gives a first estimate of the module size. Small modules make that
  // estimate coarse, so the nearest valid QR sizes are each tried and only one
  // whose finder and timing patterns are exact is accepted.
  const row = top + 1;
  let run = 0;
  while (left + run <= right && image.dark(left + run, row)) run++;
  const estimate = width / (run / 7);
  const candidates: number[] = [];
  for (let size = 21; size <= 177; size += 4) candidates.push(size);
  candidates.sort((a, b) => Math.abs(a - estimate) - Math.abs(b - estimate));
  for (const size of candidates.slice(0, 5)) {
    const module = width / size;
    if (module < 1.5) continue;
    const rows = sampleModules(image, left, top, right, bottom, size, module);
    if (rows && isQrStructure(rows)) return rows;
  }
  throw new Error("QR_IMAGE_VERSION");
}

function sampleModules(
  image: Gray,
  left: number,
  top: number,
  right: number,
  bottom: number,
  size: number,
  module: number,
) {
  const rows: string[] = [];
  for (let r = 0; r < size; r++) {
    let line = "";
    for (let c = 0; c < size; c++) {
      const x = Math.min(right, Math.floor(left + (c + 0.5) * module));
      const y = Math.min(bottom, Math.floor(top + (r + 0.5) * module));
      line += image.dark(x, y) ? "1" : "0";
    }
    rows.push(line);
  }
  return rows;
}

/** All three finder patterns with their light separators, and both timing patterns. */
function isQrStructure(rows: string[]) {
  const size = rows.length;
  for (const [r0, c0] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let r = 0; r < 7; r++) if (rows[r0 + r]!.slice(c0, c0 + 7) !== FINDER[r]) return false;
    const separatorRow = r0 === 0 ? 7 : size - 8;
    const columns = c0 === 0 ? [0, 8] : [size - 8, size];
    if (/1/.test(rows[separatorRow]!.slice(columns[0], columns[1]))) return false;
  }
  for (let i = 8; i < size - 8; i++) {
    const expected = i % 2 === 0 ? "1" : "0";
    if (rows[6]![i] !== expected || rows[i]![6] !== expected) return false;
  }
  return true;
}

/** Module rows of the QR code in a base64 PNG, e.g. Daraja's `QRCode` field. */
export async function qrModulesFromBase64Png(base64: string): Promise<string[]> {
  const clean = base64.replace(/^data:image\/png;base64,/, "").replace(/\s+/g, "");
  if (clean.length > 2_000_000) throw new Error("QR_IMAGE_SIZE");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return modulesFromImage(await decodePng(bytes));
}
