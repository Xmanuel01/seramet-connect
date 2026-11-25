// Renders Seramet's approved documents (KOT, BOT, invoice, receipt) into a
// 1-bit bitmap for ESC/POS raster printing (GS v 0). The same function draws
// the on-screen preview, so what staff see is what the printer receives.
//
// A rich document is plain JSON: styled text runs, rules, boxes, tables,
// side-by-side columns and QR module matrices. Fonts are embedded 1-bit glyph
// atlases (fonts/rich-fonts.mjs), so rendering needs no font engine and gives
// identical pixels in the browser, the server and the Windows bridge.

import { RICH_FONTS } from "./fonts/rich-fonts.mjs";

export const RICH_DOCUMENT_VERSION = 1;

/**
 * Named text styles: [face, pixel size] at 203 dpi. 80mm and 58mm each have
 * their own scale, so 58mm is an adaptation rather than a squeezed 80mm.
 */
export const RICH_STYLES = {
  "80mm": {
    title: ["sansBold", 58],
    status: ["sansBold", 36],
    orderNo: ["sansBold", 46],
    label: ["sansBold", 32],
    value: ["sans", 32],
    item: ["sansBold", 38],
    note: ["sans", 26],
    box: ["sans", 32],
    section: ["sansBold", 32],
    banner: ["sansBold", 28],
    name: ["serifBold", 54],
    nameSub: ["sansBold", 24],
    address: ["sans", 22],
    phone: ["sans", 24],
    docNo: ["sansBold", 30],
    infoLabel: ["sansBold", 24],
    infoValue: ["sans", 24],
    th: ["sansBold", 18],
    td: ["sans", 22],
    amountLabel: ["sans", 24],
    amount: ["sans", 24],
    grand: ["sansBold", 32],
    payHead: ["sansBold", 26],
    payText: ["sans", 22],
    pill: ["sansBold", 28],
    thanks: ["sansBoldItalic", 26],
    small: ["sans", 20],
  },
  "58mm": {
    title: ["sansBold", 40],
    status: ["sansBold", 26],
    orderNo: ["sansBold", 32],
    label: ["sansBold", 24],
    value: ["sans", 24],
    item: ["sansBold", 28],
    note: ["sans", 20],
    box: ["sans", 24],
    section: ["sansBold", 24],
    banner: ["sansBold", 22],
    name: ["serifBold", 38],
    nameSub: ["sansBold", 18],
    address: ["sans", 18],
    phone: ["sans", 18],
    docNo: ["sansBold", 22],
    infoLabel: ["sansBold", 18],
    infoValue: ["sans", 18],
    th: ["sansBold", 16],
    td: ["sans", 18],
    amountLabel: ["sans", 18],
    amount: ["sans", 18],
    grand: ["sansBold", 24],
    payHead: ["sansBold", 20],
    payText: ["sans", 18],
    pill: ["sansBold", 22],
    thanks: ["sansBoldItalic", 20],
    small: ["sans", 16],
  },
};

// Geometry in dots at 203 dpi, per paper.
const GEOMETRY = {
  "80mm": {
    margin: 8,
    rule: 2,
    heavy: 3,
    dash: 10,
    dashGap: 7,
    rulePad: 10,
    cellX: 6,
    cellY: 5,
    radius: 9,
  },
  "58mm": {
    margin: 4,
    rule: 2,
    heavy: 2,
    dash: 8,
    dashGap: 6,
    rulePad: 7,
    cellX: 5,
    cellY: 4,
    radius: 7,
  },
};

const LIMITS = { blocks: 400, text: 4000, total: 96000, depth: 3, qrMin: 21, qrMax: 177 };
const PHONE = "☎";

// ---------------------------------------------------------------------------
// Fonts

const decoded = new Map();

function font(paper, style) {
  const entry = RICH_STYLES[paper]?.[style];
  if (!entry) throw new Error("INVALID_RICH_STYLE");
  const key = `${entry[0]}/${entry[1]}`;
  let f = decoded.get(key);
  if (!f) {
    const atlas = RICH_FONTS[key];
    if (!atlas) throw new Error("INVALID_RICH_STYLE");
    f = { ascent: atlas.ascent, descent: atlas.descent, glyphs: new Map(), atlas };
    decoded.set(key, f);
  }
  return f;
}

function glyph(f, char) {
  const code = char.codePointAt(0);
  let g = f.glyphs.get(code);
  if (g) return g;
  const raw = f.atlas.glyphs[String(code)] ?? f.atlas.glyphs["63"];
  const [adv, x, y, w, h, bits] = raw;
  const bin =
    typeof atob === "function" ? atob(bits) : Buffer.from(bits, "base64").toString("latin1");
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  g = { adv, x, y, w, h, data, stride: (w + 7) >> 3 };
  f.glyphs.set(code, g);
  return g;
}

/**
 * Printable ASCII and the phone sign; anything else prints as "?". Line
 * breaks and tabs become spaces; deliberate runs of spaces (the approved
 * "2  x  Item" spacing) are kept.
 */
export function richText(value) {
  return [...String(value ?? "")]
    .map((c) => (c === PHONE || (c >= " " && c <= "~") ? c : /\s/.test(c) ? " " : "?"))
    .join("");
}

function textWidth(f, text, tracking = 0) {
  let sum = 0;
  for (const c of text) sum += glyph(f, c).adv;
  return Math.floor(sum / 16) + (text.length > 1 ? tracking * (text.length - 1) : 0);
}

// ---------------------------------------------------------------------------
// Canvas (one byte per dot while composing; packed at the end)

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.px = new Uint8Array(width * height);
  }
  dot(x, y) {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.px[y * this.width + x] = 1;
  }
  fill(x, y, w, h) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.dot(xx, yy);
  }
  dashed(x0, x1, y, h, dash, gap) {
    for (let x = x0; x < x1; x += dash + gap) this.fill(x, y, Math.min(dash, x1 - x), h);
  }
  frame(x, y, w, h, t, r = 0) {
    this.fill(x + r, y, w - 2 * r, t);
    this.fill(x + r, y + h - t, w - 2 * r, t);
    this.fill(x, y + r, t, h - 2 * r);
    this.fill(x + w - t, y + r, t, h - 2 * r);
    if (!r) return;
    // Quarter circles for rounded corners.
    for (let a = 0; a <= 90; a += 2) {
      const dx = Math.round(r - r * Math.cos((a * Math.PI) / 180));
      const dy = Math.round(r - r * Math.sin((a * Math.PI) / 180));
      for (let i = 0; i < t; i++)
        for (let j = 0; j < t; j++) {
          this.dot(x + dx + i, y + dy + j);
          this.dot(x + w - 1 - dx - i, y + dy + j);
          this.dot(x + dx + i, y + h - 1 - dy - j);
          this.dot(x + w - 1 - dx - i, y + h - 1 - dy - j);
        }
    }
  }
  text(f, text, x, baseline, tracking = 0) {
    let pen = 0;
    for (const c of text) {
      const g = glyph(f, c);
      const gx = x + Math.floor(pen / 16) + g.x;
      const gy = baseline + g.y;
      for (let row = 0; row < g.h; row++)
        for (let col = 0; col < g.w; col++)
          if (g.data[row * g.stride + (col >> 3)] & (0x80 >> (col & 7)))
            this.dot(gx + col, gy + row);
      pen += g.adv + tracking * 16;
    }
  }
}

// ---------------------------------------------------------------------------
// Text runs and wrapping

function lineMetrics(paper, styles) {
  let ascent = 0;
  let descent = 0;
  for (const s of styles) {
    const f = font(paper, s);
    ascent = Math.max(ascent, f.ascent);
    descent = Math.max(descent, f.descent);
  }
  return { ascent, descent, height: ascent + descent };
}

/** Word-wraps styled runs into lines of pieces [{s, text, w}]. */
function wrapRuns(paper, runs, width, hang = 0) {
  const tokens = [];
  for (const run of runs) {
    const text = richText(run.text);
    for (const part of text.split(/( )/)) if (part) tokens.push({ s: run.s, text: part });
  }
  const lines = [];
  let line = [];
  let used = 0;
  const limit = () => (lines.length ? width - hang : width);
  const push = () => {
    while (line.length && line.at(-1).text === " ") used -= line.pop().w;
    if (line.length) lines.push(line);
    line = [];
    used = 0;
  };
  for (const token of tokens) {
    const f = font(paper, token.s);
    if (token.text === " ") {
      if (!line.length) continue;
      const w = textWidth(f, " ");
      line.push({ ...token, w });
      used += w;
      continue;
    }
    let text = token.text;
    let w = textWidth(f, text);
    if (used + w > limit() && line.length) push();
    // A word longer than the line breaks across lines rather than clipping.
    while (w > limit()) {
      let cut = text.length - 1;
      while (cut > 1 && textWidth(f, text.slice(0, cut)) > limit() - used) cut--;
      line.push({ s: token.s, text: text.slice(0, cut), w: textWidth(f, text.slice(0, cut)) });
      push();
      text = text.slice(cut);
      w = textWidth(f, text);
    }
    line.push({ s: token.s, text, w });
    used += w;
  }
  push();
  return lines;
}

function runsLayout(
  paper,
  runs,
  width,
  { align = "left", indent = 0, hang = 0, leading = 0 } = {},
) {
  const lines = wrapRuns(paper, runs, width - indent, hang);
  const metrics = lines.map((line) =>
    lineMetrics(
      paper,
      line.map((p) => p.s),
    ),
  );
  const height = metrics.reduce((sum, m) => sum + m.height + leading, 0);
  return {
    height,
    lines,
    draw(c, x, y) {
      let top = y;
      lines.forEach((line, i) => {
        const m = metrics[i];
        const lineWidth = line.reduce((sum, p) => sum + p.w, 0);
        const offset = i > 0 ? hang : 0;
        const room = width - indent - offset;
        let pen =
          x +
          indent +
          offset +
          (align === "center"
            ? Math.floor((room - lineWidth) / 2)
            : align === "right"
              ? room - lineWidth
              : 0);
        for (const piece of line) {
          c.text(font(paper, piece.s), piece.text, pen, top + m.ascent);
          pen += piece.w;
        }
        top += m.height + leading;
      });
    },
  };
}

const runsWidth = (paper, runs) =>
  runs.reduce((sum, run) => sum + textWidth(font(paper, run.s), richText(run.text)), 0);

// ---------------------------------------------------------------------------
// Blocks

function layoutBlock(paper, block, width, depth = 0) {
  const g = GEOMETRY[paper];
  switch (block.t) {
    case "gap":
      return { height: block.h, draw() {} };

    case "text": {
      const pad = block.pad ?? 2;
      const inner = runsLayout(paper, block.runs, width, {
        align: block.align,
        indent: block.indent ?? 0,
        hang: block.hang ?? 0,
        leading: block.leading ?? 0,
      });
      return { height: inner.height + 2 * pad, draw: (c, x, y) => inner.draw(c, x, y + pad) };
    }

    case "rule": {
      const t = block.weight === "heavy" ? g.heavy : g.rule;
      const pad = block.pad ?? g.rulePad;
      return {
        height: t + 2 * pad,
        draw(c, x, y) {
          if (block.style === "dashed") c.dashed(x, x + width, y + pad, t, g.dash, g.dashGap);
          else c.fill(x, y + pad, width, t);
        },
      };
    }

    case "spread": {
      const left = block.left ?? [];
      const right = block.right ?? [];
      const lw = runsWidth(paper, left);
      const rw = runsWidth(paper, right);
      const boxPad = block.rightBox ? g.cellX + 4 : 0;
      const pad = block.pad ?? 2;
      if (lw + rw + 2 * boxPad + 16 > width) {
        // Too wide for one line: stack, right part right-aligned.
        const a = runsLayout(paper, left, width);
        const b = runsLayout(paper, right, width, { align: "right" });
        return {
          height: a.height + b.height + 2 * pad,
          draw(c, x, y) {
            a.draw(c, x, y + pad);
            b.draw(c, x, y + pad + a.height);
          },
        };
      }
      const m = lineMetrics(
        paper,
        [...left, ...right].map((r) => r.s),
      );
      // The boxed label (PAID) is sized to its own text and centred on the line.
      const rm = right.length
        ? lineMetrics(
            paper,
            right.map((r) => r.s),
          )
        : m;
      const boxH = block.rightBox ? rm.height + 2 * g.cellY : 0;
      const h = Math.max(m.height, boxH);
      return {
        height: h + 2 * pad,
        draw(c, x, y) {
          const base = y + pad + Math.floor((h - m.height) / 2) + m.ascent;
          let pen = x;
          for (const run of left) {
            const f = font(paper, run.s);
            const text = richText(run.text);
            c.text(f, text, pen, base);
            pen += textWidth(f, text);
          }
          const rightBase = block.rightBox
            ? y + pad + Math.floor((h - rm.height) / 2) + rm.ascent
            : base;
          pen = x + width - rw - boxPad;
          for (const run of right) {
            const f = font(paper, run.s);
            const text = richText(run.text);
            c.text(f, text, pen, rightBase);
            pen += textWidth(f, text);
          }
          if (block.rightBox)
            c.frame(
              x + width - rw - 2 * boxPad,
              y + pad + Math.floor((h - boxH) / 2),
              rw + 2 * boxPad,
              boxH,
              g.rule,
              g.radius,
            );
        },
      };
    }

    case "flanked": {
      // Centred spaced-out text with a thin line either side ("--- RESTAURANT ---").
      const run = block.runs[0];
      const f = font(paper, run.s);
      const text = richText(run.text);
      const tracking = block.tracking ?? 0;
      const tw = textWidth(f, text, tracking);
      const line = Math.min(block.line ?? 70, Math.floor((width - tw) / 2) - 12);
      const m = lineMetrics(paper, [run.s]);
      const pad = block.pad ?? 1;
      return {
        height: m.height + 2 * pad,
        draw(c, x, y) {
          const start = x + Math.floor((width - tw) / 2);
          const base = y + pad + m.ascent;
          c.text(f, text, start, base, tracking);
          if (line > 8) {
            const mid = base - Math.round(f.ascent * 0.36);
            c.fill(start - 12 - line, mid, line, g.rule);
            c.fill(start + tw + 12, mid, line, g.rule);
          }
        },
      };
    }

    case "box": {
      const inner = runsLayout(paper, block.runs, width - 2 * (g.cellX + 6), {
        align: block.align ?? "center",
      });
      const padY = g.cellY + 4;
      const h = inner.height + 2 * padY;
      return {
        height: h + 8,
        draw(c, x, y) {
          c.frame(x, y + 4, width, h, g.rule, g.radius);
          inner.draw(c, x + g.cellX + 6, y + 4 + padY);
        },
      };
    }

    case "table": {
      const t = g.rule;
      const inner = width - t * (block.cols.length + 1);
      // "auto" columns (quantities, money) shrink to their widest header or
      // value on one line; the other columns share what is left by weight, so
      // item names get every dot the numbers do not need.
      const fit = (i) => {
        const cells = [
          ...(block.head ? [[block.head[i], "th"]] : []),
          ...block.rows.map((row) => [row[i], "td"]),
        ];
        let widest = 0;
        for (const [cell, s] of cells)
          for (const part of Array.isArray(cell) ? cell : [cell])
            widest = Math.max(widest, textWidth(font(paper, s), richText(part)));
        return Math.min(widest + 2 * g.cellX, Math.floor(inner * 0.4));
      };
      const widths = block.cols.map((col, i) => (col.auto ? fit(i) : 0));
      const flexible = block.cols.map((col, i) => (col.auto ? -1 : i)).filter((i) => i >= 0);
      const left = inner - widths.reduce((a, b) => a + b, 0);
      const weight = flexible.reduce((sum, i) => sum + block.cols[i].w, 0);
      for (const i of flexible) widths[i] = Math.floor((left * block.cols[i].w) / weight);
      widths[flexible[0] ?? 0] += inner - widths.reduce((a, b) => a + b, 0);
      const rowLayout = (cells, style) =>
        cells.map((cell, i) =>
          runsLayout(
            paper,
            (Array.isArray(cell) ? cell : [cell]).flatMap((text, j) =>
              j === 0
                ? [{ s: style, text }]
                : [
                    { s: style, text: " " },
                    { s: style, text },
                  ],
            ),
            widths[i] - 2 * g.cellX,
            { align: block.cols[i].align ?? "left" },
          ),
        );
      const rows = [
        ...(block.head ? [{ cells: rowLayout(block.head, "th") }] : []),
        ...block.rows.map((row) => ({ cells: rowLayout(row, "td") })),
      ];
      // Multi-paragraph cells (item + modifiers) stack one paragraph per line.
      block.rows.forEach((row, r) => {
        row.forEach((cell, i) => {
          if (!Array.isArray(cell) || cell.length < 2) return;
          const parts = cell.map((text) =>
            runsLayout(paper, [{ s: "td", text }], widths[i] - 2 * g.cellX, {
              align: block.cols[i].align ?? "left",
            }),
          );
          rows[r + (block.head ? 1 : 0)].cells[i] = {
            height: parts.reduce((sum, p) => sum + p.height, 0),
            draw(c, x, y) {
              let top = y;
              for (const p of parts) {
                p.draw(c, x, top);
                top += p.height;
              }
            },
          };
        });
      });
      for (const row of rows)
        row.height = Math.max(...row.cells.map((cell) => cell.height)) + 2 * g.cellY;
      const height = rows.reduce((sum, row) => sum + row.height, 0) + t * (rows.length + 1);
      return {
        height: height + 4,
        draw(c, x, y0) {
          const y = y0 + 2;
          let top = y;
          c.fill(x, top, width, t);
          top += t;
          for (const row of rows) {
            let left = x + t;
            row.cells.forEach((cell, i) => {
              cell.draw(c, left + g.cellX, top + Math.floor((row.height - cell.height) / 2));
              left += widths[i] + t;
            });
            top += row.height;
            c.fill(x, top, width, t);
            top += t;
          }
          let left = x;
          for (let i = 0; i <= widths.length; i++) {
            c.fill(left, y, t, height);
            left += (widths[i] ?? 0) + t;
          }
        },
      };
    }

    case "amounts": {
      // Labels right-aligned to a column, amounts right-aligned to the edge.
      const edge = Math.floor(width * (block.labelEdge ?? 0.62));
      const rows = block.rows.map(([label, amount]) => {
        const l = runsLayout(paper, [{ s: block.label ?? "amountLabel", text: label }], edge, {
          align: "right",
        });
        const a = runsLayout(
          paper,
          [{ s: block.amount ?? "amount", text: amount }],
          width - edge - 8,
          {
            align: "right",
          },
        );
        return { l, a, height: Math.max(l.height, a.height) + 4 };
      });
      return {
        height: rows.reduce((sum, row) => sum + row.height, 0) + 4,
        draw(c, x, y) {
          let top = y + 2;
          for (const row of rows) {
            row.l.draw(c, x, top + 2);
            row.a.draw(c, x + edge + 8, top + 2);
            top += row.height;
          }
        },
      };
    }

    case "columns": {
      if (depth >= LIMITS.depth) throw new Error("INVALID_RICH_DOCUMENT");
      const gap = block.gap ?? 14;
      const divider = block.divider ? g.rule : 0;
      const n = block.cols.length;
      const room = width - (n - 1) * (2 * gap + divider);
      const total = block.cols.reduce((sum, col) => sum + col.w, 0);
      const widths = block.cols.map((col) => Math.floor((room * col.w) / total));
      widths[0] += room - widths.reduce((a, b) => a + b, 0);
      const stacks = block.cols.map((col, i) =>
        col.blocks.map((child) => layoutBlock(paper, child, widths[i], depth + 1)),
      );
      const heights = stacks.map((stack) => stack.reduce((sum, b) => sum + b.height, 0));
      const height = Math.max(...heights);
      return {
        height,
        draw(c, x, y) {
          let left = x;
          stacks.forEach((stack, i) => {
            const align = block.cols[i].valign ?? "top";
            let top = y + (align === "middle" ? Math.floor((height - heights[i]) / 2) : 0);
            for (const b of stack) {
              b.draw(c, left, top);
              top += b.height;
            }
            left += widths[i];
            if (i < n - 1) {
              if (divider) c.fill(left + gap, y + 2, divider, height - 4);
              left += 2 * gap + divider;
            }
          });
        },
      };
    }

    case "qr": {
      const n = block.modules.length;
      const quiet = 2;
      const scale = Math.max(2, Math.floor(Math.min(block.size ?? width, width) / (n + 2 * quiet)));
      const side = (n + 2 * quiet) * scale;
      return {
        height: side,
        draw(c, x, y) {
          const left =
            x +
            (block.align === "left"
              ? 0
              : block.align === "right"
                ? width - side
                : Math.floor((width - side) / 2));
          block.modules.forEach((row, r) => {
            for (let col = 0; col < n; col++)
              if (row[col] === "1")
                c.fill(left + (col + quiet) * scale, y + (r + quiet) * scale, scale, scale);
          });
        },
      };
    }

    default:
      throw new Error("INVALID_RICH_DOCUMENT");
  }
}

// ---------------------------------------------------------------------------
// Validation, rendering and ESC/POS bands

const BLOCK_TYPES = new Set([
  "gap",
  "text",
  "rule",
  "spread",
  "flanked",
  "box",
  "table",
  "amounts",
  "columns",
  "qr",
]);

/** Rejects anything that is not a well-formed, bounded rich document. */
export function validateRichDocument(doc) {
  if (
    !doc ||
    typeof doc !== "object" ||
    doc.v !== RICH_DOCUMENT_VERSION ||
    !RICH_STYLES[doc.paper] ||
    !Array.isArray(doc.blocks)
  )
    throw new Error("INVALID_RICH_DOCUMENT");
  const styles = RICH_STYLES[doc.paper];
  let count = 0;
  let chars = 0;
  const str = (value) => {
    if (typeof value !== "string" || value.length > LIMITS.text)
      throw new Error("INVALID_RICH_DOCUMENT");
    chars += value.length;
  };
  const runs = (list) => {
    if (!Array.isArray(list) || list.length > 40) throw new Error("INVALID_RICH_DOCUMENT");
    for (const run of list) {
      if (!run || !styles[run.s]) throw new Error("INVALID_RICH_DOCUMENT");
      str(run.text);
    }
  };
  const num = (value, min, max) => {
    if (value !== undefined && (!Number.isInteger(value) || value < min || value > max))
      throw new Error("INVALID_RICH_DOCUMENT");
  };
  const visit = (blocks, depth) => {
    if (!Array.isArray(blocks) || depth > LIMITS.depth) throw new Error("INVALID_RICH_DOCUMENT");
    for (const b of blocks) {
      if (++count > LIMITS.blocks || !b || !BLOCK_TYPES.has(b.t))
        throw new Error("INVALID_RICH_DOCUMENT");
      num(b.pad, 0, 60);
      num(b.indent, 0, 400);
      num(b.hang, 0, 400);
      if (b.t === "gap") num(b.h, 0, 200);
      if (b.t === "gap" && b.h === undefined) throw new Error("INVALID_RICH_DOCUMENT");
      if (["text", "box", "flanked"].includes(b.t)) runs(b.runs);
      if (b.t === "spread") {
        runs(b.left ?? []);
        runs(b.right ?? []);
      }
      if (b.t === "table") {
        if (!Array.isArray(b.cols) || b.cols.length < 2 || b.cols.length > 6)
          throw new Error("INVALID_RICH_DOCUMENT");
        for (const col of b.cols) {
          num(col.w, 1, 100);
          if (col.auto !== undefined && typeof col.auto !== "boolean")
            throw new Error("INVALID_RICH_DOCUMENT");
        }
        if (b.cols.every((col) => col.auto)) throw new Error("INVALID_RICH_DOCUMENT");
        const cell = (value) => (Array.isArray(value) ? value.forEach(str) : str(value));
        if (b.head) b.head.forEach(cell);
        if (!Array.isArray(b.rows) || b.rows.length > 200) throw new Error("INVALID_RICH_DOCUMENT");
        for (const row of [...(b.head ? [b.head] : []), ...b.rows]) {
          if (!Array.isArray(row) || row.length !== b.cols.length)
            throw new Error("INVALID_RICH_DOCUMENT");
          row.forEach(cell);
        }
      }
      if (b.t === "amounts") {
        if (!Array.isArray(b.rows) || b.rows.length > 20) throw new Error("INVALID_RICH_DOCUMENT");
        for (const row of b.rows) {
          if (!Array.isArray(row) || row.length !== 2) throw new Error("INVALID_RICH_DOCUMENT");
          row.forEach(str);
        }
        for (const s of [b.label, b.amount])
          if (s !== undefined && !styles[s]) throw new Error("INVALID_RICH_DOCUMENT");
      }
      if (b.t === "columns") {
        if (!Array.isArray(b.cols) || b.cols.length < 2 || b.cols.length > 3)
          throw new Error("INVALID_RICH_DOCUMENT");
        for (const col of b.cols) {
          num(col.w, 1, 100);
          visit(col.blocks, depth + 1);
        }
      }
      if (b.t === "qr") {
        const n = Array.isArray(b.modules) ? b.modules.length : 0;
        if (
          n < LIMITS.qrMin ||
          n > LIMITS.qrMax ||
          b.modules.some((row) => typeof row !== "string" || !new RegExp(`^[01]{${n}}$`).test(row))
        )
          throw new Error("INVALID_RICH_DOCUMENT");
        num(b.size, 60, 600);
      }
    }
  };
  visit(doc.blocks, 0);
  if (chars > LIMITS.total) throw new Error("INVALID_RICH_DOCUMENT");
}

/**
 * Renders at 203 dpi to `widthDots`. Returns packed 1-bit rows (MSB first),
 * the format GS v 0 takes.
 */
export function renderRichDocument(doc, widthDots) {
  validateRichDocument(doc);
  if (!Number.isInteger(widthDots) || widthDots < 256 || widthDots > 832 || widthDots % 8)
    throw new Error("INVALID_RICH_WIDTH");
  const g = GEOMETRY[doc.paper];
  const width = widthDots - 2 * g.margin;
  const blocks = doc.blocks.map((b) => layoutBlock(doc.paper, b, width));
  const height = blocks.reduce((sum, b) => sum + b.height, 0) + 8;
  const canvas = new Canvas(widthDots, height);
  let top = 4;
  for (const b of blocks) {
    b.draw(canvas, g.margin, top);
    top += b.height;
  }
  return pack(canvas);
}

function pack(canvas) {
  const stride = canvas.width >> 3;
  const data = new Uint8Array(stride * canvas.height);
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++)
      if (canvas.px[y * canvas.width + x]) data[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
  return { width: canvas.width, height: canvas.height, data };
}

/**
 * The bitmap for one printer profile. 300 dpi printers get the 203 dpi layout
 * scaled up, so text keeps its physical size.
 */
export function renderRichForProfile(doc, raster) {
  const dpi = raster.dpi ?? 203;
  if (dpi === 203) return renderRichDocument(doc, raster.printableWidthDots);
  const base = Math.floor((raster.printableWidthDots * 203) / dpi / 8) * 8;
  const src = renderRichDocument(doc, Math.max(256, base));
  const width = raster.printableWidthDots;
  const height = Math.round((src.height * dpi) / 203);
  const stride = width >> 3;
  const srcStride = src.width >> 3;
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * 203) / dpi));
    for (let x = 0; x < width; x++) {
      const sx = Math.floor((x * 203) / dpi);
      if (sx < src.width && src.data[sy * srcStride + (sx >> 3)] & (0x80 >> (sx & 7)))
        data[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width, height, data };
}

/** GS v 0 bands no taller than the printer's band limit. */
export function* richBands(bitmap, maxBandHeight) {
  const stride = bitmap.width >> 3;
  for (let start = 0; start < bitmap.height; start += maxBandHeight) {
    const height = Math.min(maxBandHeight, bitmap.height - start);
    yield {
      width: bitmap.width,
      height,
      start,
      data: bitmap.data.subarray(start * stride, (start + height) * stride),
    };
  }
}
