// Development and test only: never imported by the bridge itself.
//
// Replays the ESC/POS subset the bridge emits onto a bitmap, the way a 203 dpi
// thermal printer with a 12x24 Font A lays it out: line spacing, emphasis,
// CP437 box-drawing glyphs, GS v 0 raster bands and cuts. Unknown commands
// throw, so a stray byte in the encoder fails tests instead of printing junk.
import { deflateSync } from "node:zlib";
import { FONT } from "./font-5x8.mjs";

const CELL_W = 12;
const CELL_H = 24;
const DEFAULT_SPACING = 30; // ESC 2: 1/6 inch

// Arms of each CP437 box glyph: up, down, left, right, and a doubled horizontal.
const BOX = {
  0xc4: "lr",
  0xb3: "ud",
  0xda: "dr",
  0xbf: "dl",
  0xc0: "ur",
  0xd9: "ul",
  0xc3: "udr",
  0xb4: "udl",
  0xc2: "dlr",
  0xc1: "ulr",
  0xc5: "udlr",
  0xcd: "lr=",
  0xd5: "dr=",
  0xb8: "dl=",
  0xd4: "ur=",
  0xbe: "ul=",
  0xc6: "udr=",
  0xb5: "udl=",
  0xd1: "dlr=",
  0xcf: "ulr=",
  0xd8: "udlr=",
};

export function emulateEscPos(bytes, { widthDots = 576 } = {}) {
  const rows = [];
  const commands = [];
  let y = 0;
  let spacing = DEFAULT_SPACING;
  let bold = false;
  let align = 0;
  let line = [];
  const cuts = [];
  const pixel = (x, py) => {
    if (x < 0 || x >= widthDots || py < 0) return;
    (rows[py] ??= new Uint8Array(widthDots))[x] = 1;
  };
  const flush = () => {
    const width = line.length * CELL_W;
    const left = align === 1 ? (widthDots - width) >> 1 : align === 2 ? widthDots - width : 0;
    for (const [index, cell] of line.entries()) {
      const x0 = left + index * CELL_W;
      const arms = BOX[cell.code];
      if (arms) {
        const cx = x0 + CELL_W / 2 - 1;
        const cy = y + CELL_H / 2 - 1;
        const doubled = arms.includes("=");
        const horizontal = (yy) => {
          const from = arms.includes("l") ? x0 : cx;
          const to = arms.includes("r") ? x0 + CELL_W - 1 : cx + 1;
          for (let x = from; x <= to; x++) for (let d = 0; d < 2; d++) pixel(x, yy + d);
        };
        if (doubled) [cy - 3, cy + 3].forEach(horizontal);
        else if (arms.includes("l") || arms.includes("r")) horizontal(cy);
        // A single vertical meets the nearer line of a doubled horizontal.
        const top = arms.includes("u") ? y : doubled ? cy + 3 : cy;
        const bottom = arms.includes("d") ? y + CELL_H - 1 : doubled ? cy - 2 : cy + 1;
        if (arms.includes("u") || arms.includes("d"))
          for (let py = top; py <= bottom; py++) for (let d = 0; d < 2; d++) pixel(cx + d, py);
        continue;
      }
      const code = cell.code >= 32 && cell.code <= 126 ? cell.code - 32 : 31; // '?'
      for (let gx = 0; gx < 5; gx++)
        for (let gy = 0; gy < 8; gy++) {
          if (!(FONT[code * 5 + gx] & (1 << gy))) continue;
          for (let dx = 0; dx < 2 + (cell.bold ? 1 : 0); dx++)
            for (let dy = 0; dy < 2; dy++) pixel(x0 + 1 + gx * 2 + dx, y + 4 + gy * 2 + dy);
        }
    }
    line = [];
  };
  const feed = (dots) => {
    flush();
    y += dots;
  };
  let i = 0;
  const next = () => {
    if (i >= bytes.length) throw new Error("TRUNCATED_COMMAND");
    return bytes[i++];
  };
  while (i < bytes.length) {
    const b = next();
    if (b === 0x0a) {
      feed(Math.max(spacing, CELL_H));
    } else if (b === 0x1b) {
      const c = next();
      if (c === 0x40) {
        spacing = DEFAULT_SPACING;
        bold = false;
        align = 0;
        commands.push("ESC @");
      } else if (c === 0x61) align = next() % 48;
      else if (c === 0x45) bold = (next() & 1) === 1;
      else if (c === 0x32) spacing = DEFAULT_SPACING;
      else if (c === 0x33) spacing = next();
      else if (c === 0x74) {
        const page = next();
        if (page !== 0) throw new Error(`UNSUPPORTED_CODE_PAGE ${page}`);
      } else if (c === 0x64) feed(next() * Math.max(spacing, CELL_H));
      else throw new Error(`UNKNOWN_ESC 0x${c.toString(16)}`);
    } else if (b === 0x1c) {
      if (next() !== 0x2e) throw new Error("UNKNOWN_FS");
    } else if (b === 0x1d) {
      const c = next();
      if (c === 0x56) {
        const m = next();
        if (m === 65 || m === 66) next();
        else if (m > 1) throw new Error(`UNKNOWN_CUT ${m}`);
        flush();
        cuts.push({ y, feedsToCutter: m === 65 || m === 66, partial: m === 1 || m === 66 });
      } else if (c === 0x76) {
        if (next() !== 0x30) throw new Error("UNKNOWN_RASTER");
        next();
        const stride = next() | (next() << 8);
        const height = next() | (next() << 8);
        flush();
        for (let py = 0; py < height; py++)
          for (let x = 0; x < stride * 8; x++)
            if (bytes[i + py * stride + (x >> 3)] & (0x80 >> (x & 7))) pixel(x, y + py);
        i += stride * height;
        y += height;
      } else throw new Error(`UNKNOWN_GS 0x${c.toString(16)}`);
    } else if (b < 0x20) {
      throw new Error(`CONTROL_BYTE_IN_TEXT 0x${b.toString(16)}`);
    } else {
      line.push({ code: b, bold });
    }
  }
  flush();
  return { widthDots, heightDots: Math.max(y, rows.length), rows, cuts, commands };
}

/** Paper length in millimetres at 203 dpi (8 dots per mm). */
export function paperMillimetres(result) {
  return Math.round((result.heightDots / 8) * 10) / 10;
}

/** 8-bit greyscale PNG with a one-dot frame, for previews. */
export function emulatorPng(result, scale = 1) {
  const width = result.widthDots * scale + 2;
  const height = result.heightDots * scale + 2;
  const raw = Buffer.alloc((width + 1) * height, 255);
  for (let py = 0; py < height; py++) {
    raw[py * (width + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const frame = x === 0 || py === 0 || x === width - 1 || py === height - 1;
      const sx = Math.floor((x - 1) / scale);
      const sy = Math.floor((py - 1) / scale);
      const ink = !frame && result.rows[sy]?.[sx];
      raw[py * (width + 1) + 1 + x] = frame ? 200 : ink ? 0 : 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
