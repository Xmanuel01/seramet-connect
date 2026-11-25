// A 1-bit print bitmap (1 = black) as a greyscale PNG, with no dependencies.
import { deflateSync } from "node:zlib";
import type { RichBitmap } from "../printing-core/rich-render.mjs";

export function bitmapToPng(bitmap: RichBitmap): Buffer {
  const stride = bitmap.width >> 3;
  const raw = Buffer.alloc((bitmap.width + 1) * bitmap.height);
  for (let y = 0; y < bitmap.height; y++) {
    raw[y * (bitmap.width + 1)] = 0;
    for (let x = 0; x < bitmap.width; x++) {
      const on = bitmap.data[y * stride + (x >> 3)]! & (0x80 >> (x & 7));
      raw[y * (bitmap.width + 1) + 1 + x] = on ? 0 : 255;
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (data: Buffer) => {
    let c = 0xffffffff;
    for (const byte of data) c = table[(c ^ byte) & 255]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(bitmap.width, 0);
  header.writeUInt32BE(bitmap.height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
