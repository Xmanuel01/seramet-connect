// Turns the ruled ASCII the templates emit (`+---+` rules, `|cell|` rows) into
// box-drawing glyphs, so text-mode printers and previews draw continuous lines
// instead of dashes and pipes. Borders are found exactly as buildThermalLayout
// finds them for raster printing: a row's inner `|` is a border only where the
// rule above it has a `+`, so a `|` typed inside a cell stays a character.

const RULE = /^[+\-=]{3,}$/;

// Index: up, down, left, right as bits 8/4/2/1.
const SINGLE = {
  3: "─",
  1: "─",
  2: "─",
  0: "─",
  5: "┌",
  6: "┐",
  9: "└",
  10: "┘",
  13: "├",
  14: "┤",
  7: "┬",
  11: "┴",
  15: "┼",
  12: "│",
  4: "│",
  8: "│",
};
// Double horizontal crossing single verticals (CP437 has these, like ═╪╧).
const DOUBLE = {
  3: "═",
  1: "═",
  2: "═",
  0: "═",
  5: "╒",
  6: "╕",
  9: "╘",
  10: "╛",
  13: "╞",
  14: "╡",
  7: "╤",
  11: "╧",
  15: "╪",
  12: "│",
  4: "│",
  8: "│",
};

export const SOLID_RULE_GLYPHS = "─│┌┐└┘├┤┬┴┼═╒╕╘╛╞╡╤╧╪";

/**
 * Lines with their table borders replaced by box-drawing glyphs. `ruled[i]`
 * is true for rule lines and table rows, which must print without extra line
 * spacing for the vertical borders to touch.
 */
export function solidRuleLines(content) {
  const lines = content.split("\n");
  let junctions = [];
  const borders = lines.map((text) => {
    if (RULE.test(text)) {
      junctions = [...text].flatMap((c, i) => (c === "+" ? [i] : []));
      return null;
    }
    if (text.length < 2 || !text.startsWith("|") || !text.endsWith("|")) return null;
    return new Set([0, ...junctions.filter((i) => text[i] === "|"), text.length - 1]);
  });
  const ruled = lines.map((text, i) => RULE.test(text) || borders[i] !== null);
  const solid = lines.map((text, i) => {
    if (borders[i]) return [...text].map((c, x) => (borders[i].has(x) ? "│" : c)).join("");
    if (!RULE.test(text)) return text;
    const above = borders[i - 1];
    const below = borders[i + 1];
    const glyphs = text.includes("=") ? DOUBLE : SINGLE;
    return [...text]
      .map((c, x) => {
        if (c !== "+") return glyphs[3];
        const up = above?.has(x) ? 8 : 0;
        const down = below?.has(x) ? 4 : 0;
        const left = x > 0 ? 2 : 0;
        const right = x < text.length - 1 ? 1 : 0;
        return glyphs[up | down | left | right];
      })
      .join("");
  });
  return { lines: solid, ruled };
}

/** The whole document with solid rules, for on-screen previews. */
export function solidRules(content) {
  return solidRuleLines(content).lines.join("\n");
}
