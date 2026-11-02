import { solidRuleLines } from "../printing-core/solid-rules.mjs";

const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;

// CP437 (ESC t 0, the ESC/POS default page) box-drawing bytes.
const CP437 = {
  "─": 0xc4,
  "│": 0xb3,
  "┌": 0xda,
  "┐": 0xbf,
  "└": 0xc0,
  "┘": 0xd9,
  "├": 0xc3,
  "┤": 0xb4,
  "┬": 0xc2,
  "┴": 0xc1,
  "┼": 0xc5,
  "═": 0xcd,
  "╒": 0xd5,
  "╕": 0xb8,
  "╘": 0xd4,
  "╛": 0xbe,
  "╞": 0xc6,
  "╡": 0xb5,
  "╤": 0xd1,
  "╧": 0xcf,
  "╪": 0xd8,
};

// ESC 3 0: the feed becomes the character height, so the box glyphs of one
// row meet the next. ESC 2 restores the printer's default spacing.
const NO_SPACING = [ESC, 0x33, 0];
const DEFAULT_SPACING = [ESC, 0x32];

export function isStrongText(line, index) {
  return (
    index === 0 ||
    /^(BILL|RECEIPT|TAX INVOICE|PAID|DUPLICATE COPY)$/.test(line.trim()) ||
    /^(KITCHEN ORDER|BAR ORDER|KDS ORDER|KOT #|BAR #)/.test(line.trim()) ||
    /^\|\s*TOTAL\s*\|/.test(line) ||
    /SPECIAL REQUEST|ALLERG(?:Y|EN|IC)|REPRINT/.test(line.toUpperCase())
  );
}

/** Feed to the cutter and cut (GS V 66/65 0), or clear the tear bar when there is none. */
export function finishCommands(cutter) {
  if (cutter === "partial") return Buffer.from([GS, 0x56, 66, 0]);
  if (cutter === "full") return Buffer.from([GS, 0x56, 65, 0]);
  if (cutter === "none") return Buffer.from([ESC, 0x64, 3]);
  throw new Error("UNSUPPORTED_CUTTER");
}

export function encodeEscPos(content, profile) {
  if (!["58mm", "80mm"].includes(profile.paperWidth) || profile.encoding !== "ascii") {
    throw new Error("UNSUPPORTED_PRINTER_PROFILE");
  }
  if (![undefined, "SOLID", "ASCII"].includes(profile.ruleStyle))
    throw new Error("UNSUPPORTED_RULE_STYLE");
  const columns = profile.paperWidth === "58mm" ? 32 : 42;
  const solid = profile.ruleStyle !== "ASCII";
  // User-controlled strings never become device commands. Unsupported glyphs
  // are visible replacement characters, not silently dropped control bytes.
  const safe = content.replace(/[^\x20-\x7e\n]/g, "?");
  const source = solid ? solidRuleLines(safe) : null;
  const lines = safe.split("\n").flatMap((line, index) => {
    // Ruled lines already fit the paper; only plain text is wrapped.
    if (source?.ruled[index] && line.length <= columns)
      return [{ text: source.lines[index], ascii: line, ruled: true }];
    const result = [];
    while (line.length > columns) {
      const space = line.lastIndexOf(" ", columns);
      const split = space > 0 ? space : columns;
      result.push(line.slice(0, split));
      line = line.slice(split).trimStart();
    }
    return [...result, line].map((text) => ({ text, ascii: text, ruled: false }));
  });
  // ESC @ resets; FS . leaves Chinese/Kanji double-byte mode, which some
  // clones default to, so CP437 bytes above 0x7F print as single glyphs.
  const buffers = [
    Buffer.from([ESC, 0x40, ...(solid ? [FS, 0x2e, ESC, 0x74, 0] : []), ESC, 0x61, 0]),
  ];
  let spacing = "default";
  for (const [index, line] of lines.entries()) {
    const wanted = line.ruled && lines[index + 1]?.ruled ? "none" : "default";
    if (wanted !== spacing) {
      buffers.push(Buffer.from(wanted === "none" ? NO_SPACING : DEFAULT_SPACING));
      spacing = wanted;
    }
    // Emphasis is chosen from the sanitized ASCII, never from embedded control
    // codes, and covers text only so bold rows keep the same thin borders.
    const strong = profile.emphasis && isStrongText(line.ascii, index);
    for (const run of line.text.match(/[─-╿]+|[^─-╿]+/g) ?? []) {
      if (CP437[run[0]] !== undefined) {
        buffers.push(Buffer.from([...run].map((glyph) => CP437[glyph])));
      } else if (strong) {
        buffers.push(
          Buffer.from([ESC, 0x45, 1]),
          Buffer.from(run, "ascii"),
          Buffer.from([ESC, 0x45, 0]),
        );
      } else {
        buffers.push(Buffer.from(run, "ascii"));
      }
    }
    buffers.push(Buffer.from("\n", "ascii"));
  }
  if (spacing !== "default") buffers.push(Buffer.from(DEFAULT_SPACING));
  buffers.push(finishCommands(profile.cutter));
  return Buffer.concat(buffers);
}
