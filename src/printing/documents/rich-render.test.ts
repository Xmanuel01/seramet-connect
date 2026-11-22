import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import {
  RICH_STYLES,
  renderRichDocument,
  renderRichForProfile,
  validateRichDocument,
  type RichBitmap,
  type RichDocument,
  type RichStyle,
} from "../../../printing-core/rich-render.mjs";
import { richRasterMetrics, validateRenderJob } from "../../../printing-core/thermal-layout.mjs";
import { approvedReferenceSamples } from "../../../scripts/approved-reference-samples";
import { renderApprovedInvoice, renderApprovedReceipt, renderOrderTicket } from "./approved";

const DOTS = { "80mm": 576, "58mm": 384 } as const;
const PAPERS = ["80mm", "58mm"] as const;

const ink = (b: RichBitmap, x: number, y: number) =>
  (b.data[y * (b.width >> 3) + (x >> 3)]! & (0x80 >> (x & 7))) !== 0;

/** Rows that contain any ink, grouped into bands: one band per printed line or rule. */
function inkBands(b: RichBitmap) {
  const bands: Array<{ top: number; bottom: number; left: number; right: number; dots: number }> =
    [];
  let current: (typeof bands)[number] | undefined;
  for (let y = 0; y < b.height; y++) {
    let left = -1;
    let right = -1;
    let dots = 0;
    for (let x = 0; x < b.width; x++)
      if (ink(b, x, y)) {
        if (left < 0) left = x;
        right = x;
        dots++;
      }
    if (dots && current && current.bottom === y - 1) {
      current.bottom = y;
      current.left = Math.min(current.left, left);
      current.right = Math.max(current.right, right);
      current.dots += dots;
    } else if (dots) {
      current = { top: y, bottom: y, left, right, dots };
      bands.push(current);
    }
  }
  return bands;
}

/**
 * Approved reference bitmaps. A change here means the printed documents look
 * different: regenerate docs/print-previews/approved with
 * `npx vite-node scripts/render-approved-previews.ts`, compare against the
 * approved design, then update these hashes.
 */
const GOLDEN: Record<string, string> = {
  "kot-80mm": "688944e1bbeec884",
  "bot-80mm": "ee550d7a230531b2",
  "invoice-80mm": "a787fa148e1febd6",
  "receipt-80mm": "6c09226a81f0127c",
  "kot-58mm": "8b6e2ae860be3353",
  "bot-58mm": "38b2031a22756874",
  "invoice-58mm": "0f46383205691e58",
  "receipt-58mm": "7dd77414b652f080",
};

describe("approved documents: visual regression", () => {
  for (const paper of PAPERS)
    for (const { name, job } of approvedReferenceSamples(paper)) {
      it(`${name} on ${paper} renders the approved bitmap`, () => {
        expect(job.rich, "every approved document has a typeset form").toBeDefined();
        const bitmap = renderRichForProfile(job.rich!, {
          printableWidthDots: DOTS[paper],
          dpi: 203,
        });
        expect(bitmap.width).toBe(DOTS[paper]);
        const hash = createHash("sha256").update(bitmap.data).digest("hex").slice(0, 16);
        expect(hash).toBe(GOLDEN[`${name}-${paper}`]);
        // Same input, same pixels: preview and printer can never disagree.
        expect(renderRichDocument(job.rich!, DOTS[paper]).data).toEqual(bitmap.data);
      });

      it(`${name} on ${paper} keeps every dot inside the printable margins`, () => {
        const bitmap = renderRichDocument(job.rich!, DOTS[paper]);
        const margin = paper === "80mm" ? 8 : 4;
        for (let y = 0; y < bitmap.height; y++)
          for (const x of [
            ...Array(margin).keys(),
            ...Array.from({ length: margin }, (_, i) => bitmap.width - 1 - i),
          ])
            expect(ink(bitmap, x, y), `ink at ${x},${y}`).toBe(false);
      });

      it(`${name} on ${paper} has no black-filled bars or headers`, () => {
        const bitmap = renderRichDocument(job.rich!, DOTS[paper]);
        // A filled bar is close to solid ink; even bold title text stays near 50%.
        for (const band of inkBands(bitmap)) {
          const height = band.bottom - band.top + 1;
          const area = height * (band.right - band.left + 1);
          if (height > 6) expect(band.dots / area, `band at ${band.top}`).toBeLessThan(0.75);
        }
      });
    }
});

describe("approved documents: typography hierarchy", () => {
  /** Height in dots of capital letters in one style. */
  const capHeight = (paper: (typeof PAPERS)[number], s: RichStyle) => {
    const bitmap = renderRichDocument(
      { v: 1, paper, blocks: [{ t: "text", runs: [{ s, text: "HEXAGON" }] }] },
      DOTS[paper],
    );
    const [band] = inkBands(bitmap);
    return band!.bottom - band!.top + 1;
  };

  for (const paper of PAPERS)
    it(`titles > order numbers > items > details > instructions on ${paper}`, () => {
      const title = capHeight(paper, "title");
      const order = capHeight(paper, "orderNo");
      const item = capHeight(paper, "item");
      const value = capHeight(paper, "value");
      const note = capHeight(paper, "note");
      expect(title).toBeGreaterThan(order);
      expect(order).toBeGreaterThan(item);
      expect(item).toBeGreaterThan(value);
      expect(value).toBeGreaterThan(note);
      expect(capHeight(paper, "grand")).toBeGreaterThan(capHeight(paper, "amount"));
      // Bold styles really are heavier than regular ones of similar size.
      const weight = (s: RichStyle) =>
        inkBands(
          renderRichDocument(
            { v: 1, paper, blocks: [{ t: "text", runs: [{ s, text: "MMMM" }] }] },
            DOTS[paper],
          ),
        )[0]!.dots;
      expect(weight("label")).toBeGreaterThan(weight("value"));
    });

  it("uses a serif face for the restaurant name and sans-serif elsewhere", () => {
    expect(RICH_STYLES["80mm"].name[0]).toBe("serifBold");
    for (const [style, [face]] of Object.entries(RICH_STYLES["80mm"]))
      if (style !== "name") expect(face.startsWith("sans"), style).toBe(true);
  });
});

describe("approved documents: layout behaviour", () => {
  it("wraps long items and instructions instead of clipping", () => {
    for (const paper of PAPERS) {
      const long = "Slow-cooked coastal coconut fish curry with saffron pilau and kachumbari";
      const doc = renderOrderTicket(
        {
          station: "KITCHEN",
          status: "NEW",
          orderNumber: "ORD-1",
          date: "22 Nov 2026",
          time: "10:24 AM",
          lines: [{ name: long, quantity: 12, note: `${long}, no chilli at all` }],
          generalInstructions: `${long} - pack every portion separately`,
          requestedBy: "Emmanuel O.",
        },
        { paper },
      ).rich!;
      const bitmap = renderRichDocument(doc, DOTS[paper]);
      const margin = paper === "80mm" ? 8 : 4;
      for (let y = 0; y < bitmap.height; y++) {
        expect(ink(bitmap, margin - 1, y)).toBe(false);
        expect(ink(bitmap, bitmap.width - margin, y)).toBe(false);
      }
      expect(JSON.stringify(doc)).toContain(long);
    }
  });

  it("draws a real M-Pesa QR beside the payment details, and none without a payload", () => {
    const payload = "SERAMET LAYOUT TEST - NOT A PAYMENT CODE";
    const input = {
      business: { name: "Mona Swahili Restaurant" },
      invoiceNumber: "INV-1",
      date: "22 Nov 2026",
      time: "10:25 AM",
      lines: [{ name: "Ugali", quantity: 1, unitPrice: 150 }],
      totals: { subtotal: 150, total: 150 },
    };
    const live = renderApprovedInvoice(
      { ...input, mpesa: { till: "4235484", qrPayload: payload } },
      { paper: "80mm", currency: "KES" },
    ).rich!;
    const columns = live.blocks.find(
      (b) => b.t === "columns" && b.cols[0]!.blocks[0]!.t === "qr",
    ) as Extract<RichDocument["blocks"][number], { t: "columns" }>;
    const qr = columns.cols[0]!.blocks[0] as Extract<RichDocument["blocks"][number], { t: "qr" }>;
    expect(qr.t).toBe("qr");
    expect(JSON.stringify(columns.cols[1])).toContain("SCAN TO PAY");
    // The printed modules are exactly the encoder's matrix for this payload.
    const matrix = QRCode.create(payload, { errorCorrectionLevel: "M" }).modules;
    expect(qr.modules).toHaveLength(matrix.size);
    for (let r = 0; r < matrix.size; r++)
      for (let c = 0; c < matrix.size; c++)
        expect(qr.modules[r]![c]).toBe(matrix.get(r, c) ? "1" : "0");
    // And the bitmap carries them: sample every module centre.
    const doc: RichDocument = {
      v: 1,
      paper: "80mm",
      blocks: [{ t: "qr", modules: qr.modules, size: 190 }],
    };
    const bitmap = renderRichDocument(doc, 576);
    const scale = Math.floor(190 / (matrix.size + 4));
    const left = 8 + Math.floor((560 - (matrix.size + 4) * scale) / 2);
    for (let r = 0; r < matrix.size; r++)
      for (let c = 0; c < matrix.size; c++)
        expect(
          ink(bitmap, left + (c + 2) * scale + (scale >> 1), 4 + (r + 2) * scale + (scale >> 1)),
        ).toBe(matrix.get(r, c) === 1);
    const fallback = renderApprovedInvoice(
      { ...input, mpesa: { till: "4235484" } },
      { paper: "80mm", currency: "KES" },
    ).rich!;
    expect(JSON.stringify(fallback)).not.toContain('"t":"qr"');
    expect(JSON.stringify(fallback)).toContain("PAY WITH M-PESA");
  });

  it("puts eTIMS beside the payment details only with real fiscal data", () => {
    const input = {
      business: { name: "Mona Swahili Restaurant" },
      receiptNumber: "RCP-1",
      date: "22 Nov 2026",
      time: "11:36 AM",
      lines: [{ name: "Eggs", quantity: 1, unitPrice: 250 }],
      totals: { subtotal: 250, total: 250 },
      payments: [{ method: "M-Pesa", amount: 250, reference: "TKM3QX81ZP" }],
      paid: 250,
    };
    const ctx = { paper: "80mm" as const, currency: "KES" };
    const signed = renderApprovedReceipt(
      {
        ...input,
        etims: {
          status: "SIGNED",
          cuSerial: "KRAMW017202207012345",
          cuInvoiceNumber: "0170123450000012345",
          verifyUrl: "https://etims.kra.go.ke/verify/0170123450000012345",
        },
      },
      ctx,
    ).rich!;
    const text = JSON.stringify(signed);
    expect(text).toContain("eTIMS VERIFY");
    expect(text).toContain('"t":"qr"');
    expect(text.indexOf("PAYMENT DETAILS")).toBeLessThan(text.indexOf("eTIMS VERIFY"));
    const none = JSON.stringify(renderApprovedReceipt(input, ctx).rich);
    expect(none).not.toMatch(/eTIMS|"t":"qr"/);
  });
});

describe("rich documents: validation and printer limits", () => {
  const ok: RichDocument = {
    v: 1,
    paper: "80mm",
    blocks: [{ t: "text", runs: [{ s: "title", text: "X" }] }],
  };
  it("rejects malformed or unbounded documents", () => {
    expect(() => validateRichDocument(ok)).not.toThrow();
    for (const bad of [
      { ...ok, v: 2 },
      { ...ok, paper: "A4" },
      { ...ok, blocks: [{ t: "script", code: "x" }] },
      { ...ok, blocks: [{ t: "text", runs: [{ s: "huge", text: "X" }] }] },
      { ...ok, blocks: [{ t: "text", runs: [{ s: "title", text: "X".repeat(5000) }] }] },
      { ...ok, blocks: [{ t: "qr", modules: ["01"] }] },
      { ...ok, blocks: [{ t: "qr", modules: Array(21).fill("2".repeat(21)) }] },
      { ...ok, blocks: Array(401).fill({ t: "gap", h: 1 }) },
    ])
      expect(() => validateRichDocument(bad), JSON.stringify(bad).slice(0, 60)).toThrow();
  });

  it("checks the rendered size against the printer's raster limits", () => {
    const profile = {
      paperWidth: "80mm",
      encoding: "ascii",
      cutter: "partial",
      renderingMode: "RASTER_ESC_POS",
      raster: {
        command: "GS_V_0",
        printableWidthDots: 576,
        dpi: 203,
        maxBandHeight: 128,
        maxHeightDots: 8192,
        maxBytes: 524288,
      },
    };
    const [{ job }] = approvedReferenceSamples("80mm");
    const metrics = richRasterMetrics(job.rich!, profile);
    expect(metrics.bytes).toBeLessThan(150000);
    expect(() =>
      richRasterMetrics(job.rich!, {
        ...profile,
        raster: { ...profile.raster, maxHeightDots: 256 },
      }),
    ).toThrow(/RASTER_SIZE_LIMIT/);
    // A v3 job must carry the typeset document and no legacy layout or logo.
    const target = { id: "p", transport: "TCP", host: "192.168.1.20" };
    const base = { v: 3, content: job.content, rich: job.rich, target, profile };
    expect(() => validateRenderJob(base)).not.toThrow();
    expect(() => validateRenderJob({ ...base, rich: undefined })).toThrow();
    expect(() => validateRenderJob({ ...base, document: {} })).toThrow();
    expect(() => validateRenderJob({ ...base, v: 2 })).toThrow();
    expect(() =>
      validateRenderJob({ ...base, target: { ...target, transport: "WINDOWS" } }),
    ).not.toThrow();
    // 300 dpi printers keep the physical size: the bitmap is scaled up.
    const hi = renderRichForProfile(job.rich!, { printableWidthDots: 832, dpi: 300 });
    expect(hi.width).toBe(832);
  });
});
