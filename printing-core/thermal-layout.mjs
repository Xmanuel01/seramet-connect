// Versioned, printer-independent compatibility adapter for the existing ruled
// templates. Both renderers consume the same authorized business content.
export const MAX_LAYOUT_ROWS = 512;
export function isStrongLine(line, index) {
  return (
    index === 0 ||
    /^(BILL|RECEIPT|TAX INVOICE|PAID|DUPLICATE COPY)$/.test(line.trim()) ||
    /^(KITCHEN ORDER|BAR ORDER|KDS ORDER|KOT #|BAR #)/.test(line.trim()) ||
    /^\|\s*TOTAL\s*\|/.test(line) ||
    /SPECIAL REQUEST|ALLERG(?:Y|EN|IC)|REPRINT/.test(line.toUpperCase())
  );
}
export function buildThermalLayout(content, paperWidth) {
  if (
    !["58mm", "80mm"].includes(paperWidth) ||
    typeof content !== "string" ||
    content.length > 128000
  )
    throw new Error("INVALID_DOCUMENT_LAYOUT");
  const columns = paperWidth === "58mm" ? 32 : 42;
  const lines = content.replace(/[^\x20-\x7e\n]/g, "?").split("\n");
  if (!lines.length || lines.length > MAX_LAYOUT_ROWS || lines.some((l) => l.length > columns))
    throw new Error("DOCUMENT_LAYOUT_LIMIT");
  let junctions = [];
  const rows = lines.map((text, index) => {
    const strong = isStrongLine(text, index);
    if (/^[+\-=]{3,}$/.test(text)) {
      junctions = [...text].flatMap((c, i) => (c === "+" ? [i] : []));
      return { kind: "rule", text, borders: junctions, strong };
    }
    const table = text.startsWith("|") && text.endsWith("|");
    const borders = table
      ? [...new Set([0, ...junctions.filter((i) => text[i] === "|"), text.length - 1])]
      : [];
    return { kind: table ? "table" : "text", text, borders, strong };
  });
  return { version: 1, renderer: "SERAMET_5X8_adafruit-e6ffe30f00a6_V1", columns, rows };
}
export function validateRenderProfile(profile, transport = "TCP") {
  if (
    !profile ||
    !["58mm", "80mm"].includes(profile.paperWidth) ||
    profile.encoding !== "ascii" ||
    !["none", "partial", "full"].includes(profile.cutter) ||
    ![undefined, "TEXT_ESC_POS", "RASTER_ESC_POS"].includes(profile.renderingMode) ||
    ![undefined, "SOLID", "ASCII"].includes(profile.ruleStyle)
  )
    throw new Error("UNSUPPORTED_RENDER_PROFILE");
  if (profile.renderingMode !== "RASTER_ESC_POS") return;
  const r = profile.raster;
  if (
    transport !== "TCP" ||
    !r ||
    r.command !== "GS_V_0" ||
    !Number.isInteger(r.printableWidthDots) ||
    r.printableWidthDots < 256 ||
    r.printableWidthDots > 832 ||
    r.printableWidthDots % 8 ||
    r.printableWidthDots < (profile.paperWidth === "58mm" ? 32 : 42) * 8 ||
    ![203, 300].includes(r.dpi) ||
    !Number.isInteger(r.maxBandHeight) ||
    r.maxBandHeight < 16 ||
    r.maxBandHeight > 256 ||
    !Number.isInteger(r.maxHeightDots) ||
    r.maxHeightDots < 256 ||
    r.maxHeightDots > 32768 ||
    !Number.isInteger(r.maxBytes) ||
    r.maxBytes < 4096 ||
    r.maxBytes > 1048576
  )
    throw new Error("UNSUPPORTED_RASTER_PROFILE");
}
export function rasterMetrics(layout, profile) {
  validateRenderProfile(profile);
  if (
    profile.renderingMode !== "RASTER_ESC_POS" ||
    layout?.version !== 1 ||
    layout.columns !== (profile.paperWidth === "58mm" ? 32 : 42) ||
    !Array.isArray(layout.rows) ||
    !layout.rows.length ||
    layout.rows.length > MAX_LAYOUT_ROWS
  )
    throw new Error("INVALID_DOCUMENT_LAYOUT");
  const lineHeight = Math.round((28 * profile.raster.dpi) / 203);
  const heights = layout.rows.map((r) => (r.kind === "rule" ? 2 : lineHeight));
  const height = heights.reduce((a, b) => a + b, 0);
  const stride = profile.raster.printableWidthDots / 8;
  const bands = Math.ceil(height / profile.raster.maxBandHeight);
  // ESC @ ESC a 0, then ESC d 3 to clear a tear bar or GS V 66/65 0 to feed to the cutter.
  const bytes = stride * height + bands * 8 + 5 + (profile.cutter === "none" ? 3 : 4);
  if (height > profile.raster.maxHeightDots || bytes > profile.raster.maxBytes)
    throw new Error("RASTER_SIZE_LIMIT");
  return { heights, height, stride, bands, bytes, lineHeight };
}
export function validateRenderJob(job) {
  const hasRaster = [job.profile, job.fallbackProfile].some(
    (p) => p?.renderingMode === "RASTER_ESC_POS",
  );
  if (
    ![1, 2].includes(job.v) ||
    hasRaster !== (job.v === 2) ||
    (!hasRaster && job.document !== undefined)
  )
    throw new Error("UNSUPPORTED_RENDER_ENVELOPE");
  for (const [target, profile] of [
    [job.target, job.profile],
    [job.fallbackTarget, job.fallbackProfile],
  ]) {
    if (!target) continue;
    validateRenderProfile(profile, target.transport);
    if (profile.renderingMode === "RASTER_ESC_POS") {
      const expected = buildThermalLayout(job.content, profile.paperWidth);
      if (JSON.stringify(expected) !== JSON.stringify(job.document))
        throw new Error("DOCUMENT_INTEGRITY_MISMATCH");
      rasterMetrics(expected, profile);
    }
  }
}
