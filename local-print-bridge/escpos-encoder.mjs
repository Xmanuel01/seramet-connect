const ESC = 0x1b;
const GS = 0x1d;

export function encodeEscPos(content, profile) {
  if (!["58mm", "80mm"].includes(profile.paperWidth) || profile.encoding !== "ascii") {
    throw new Error("UNSUPPORTED_PRINTER_PROFILE");
  }
  const columns = profile.paperWidth === "58mm" ? 32 : 42;
  // User-controlled strings never become device commands. Unsupported glyphs
  // are visible replacement characters, not silently dropped control bytes.
  const safe = content.replace(/[^\x20-\x7e\n]/g, "?");
  const lines = safe.split("\n").flatMap((line) => {
    const result = [];
    while (line.length > columns) {
      const space = line.lastIndexOf(" ", columns);
      const split = space > 0 ? space : columns;
      result.push(line.slice(0, split));
      line = line.slice(split).trimStart();
    }
    return [...result, line];
  });
  const buffers = [Buffer.from([ESC, 0x40, ESC, 0x61, 0])];
  for (const [index, line] of lines.entries()) {
    // Emphasis is chosen from sanitized text, never from embedded control codes.
    const strong =
      profile.emphasis &&
      (index === 0 ||
        /^(BILL|RECEIPT|TAX INVOICE|PAID|DUPLICATE COPY)$/.test(line.trim()) ||
        /^(KITCHEN ORDER|BAR ORDER|KDS ORDER|KOT #|BAR #)/.test(line.trim()) ||
        /^\|\s*TOTAL\s*\|/.test(line) ||
        /SPECIAL REQUEST|ALLERG(?:Y|EN|IC)|REPRINT/.test(line.toUpperCase()));
    if (strong) buffers.push(Buffer.from([ESC, 0x45, 1]));
    buffers.push(Buffer.from(line + "\n", "ascii"));
    if (strong) buffers.push(Buffer.from([ESC, 0x45, 0]));
  }
  buffers.push(Buffer.from([ESC, 0x64, 3]));
  if (profile.cutter === "partial") buffers.push(Buffer.from([GS, 0x56, 1]));
  else if (profile.cutter === "full") buffers.push(Buffer.from([GS, 0x56, 0]));
  else if (profile.cutter !== "none") throw new Error("UNSUPPORTED_CUTTER");
  return Buffer.concat(buffers);
}
