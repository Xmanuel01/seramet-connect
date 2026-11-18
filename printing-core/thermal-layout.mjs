// Versioned, printer-independent compatibility adapter for the existing ruled
// templates. Both renderers consume the same authorized business content.
export const MAX_LAYOUT_ROWS = 512;
// A receipt logo is a 1-bit image printed centred above the document. 384 dots
// fits 58mm paper and every 80mm printer; 200 dots is about 25mm tall at 203 dpi.
export const MAX_LOGO_WIDTH = 384;
export const MAX_LOGO_HEIGHT = 200;
export const LOGO_DOCUMENT_TYPES = ["BILL", "RECEIPT", "INVOICE"];
/** Checks a logo's shape and returns the size of its image bytes. */
export function validateLogo(logo) {
  if (
    !logo ||
    typeof logo !== "object" ||
    Object.keys(logo).sort().join(",") !== "data,height,width" ||
    !Number.isInteger(logo.width) ||
    !Number.isInteger(logo.height) ||
    logo.width < 8 ||
    logo.width > MAX_LOGO_WIDTH ||
    logo.height < 1 ||
    logo.height > MAX_LOGO_HEIGHT ||
    typeof logo.data !== "string" ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(logo.data)
  )
    throw new Error("INVALID_LOGO");
  const bytes = Math.ceil(logo.width / 8) * logo.height;
  if (logo.data.length !== 4 * Math.ceil(bytes / 3)) throw new Error("INVALID_LOGO");
  return bytes;
}
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
  // ESC @ ESC a 0, then ESC d 5 to clear a tear bar or GS V 66/65 0 to feed to the cutter.
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
  // ESC a 1, GS v 0 header, the image, a line feed and ESC a 0.
  const logoBytes = job.logo === undefined ? 0 : validateLogo(job.logo) + 15;
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
      const metrics = rasterMetrics(expected, profile);
      if (
        logoBytes &&
        (job.logo.width > profile.raster.printableWidthDots ||
          metrics.bytes + logoBytes > profile.raster.maxBytes)
      )
        throw new Error("RASTER_SIZE_LIMIT");
    }
  }
}
