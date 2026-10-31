// Width-adaptive building blocks for Seramet printed documents.
//
// Everything here emits the ruled ASCII format that printing-core already
// understands: `+---+---+` rules and `|cell|cell|` rows. The raster renderer
// draws those as continuous lines; text-mode printers print them as ASCII.
// Adjacent tables share one merged rule, so stacked sections never waste a
// line on a double border.

export type Paper = "58mm" | "80mm" | "A4";

/** Characters per line for each paper. Must match printing-core (32/42) and the A4 text width. */
export const PAPER_COLUMNS: Record<Paper, number> = { "58mm": 32, "80mm": 42, A4: 78 };

export function columnsFor(paper: Paper | number): number {
  const width = typeof paper === "number" ? paper : PAPER_COLUMNS[paper];
  if (!Number.isInteger(width) || width < 24 || width > 120)
    throw new Error("UNSUPPORTED_PAPER_WIDTH");
  return width;
}

/** A section is a list of finished lines; falsy entries are skipped when composing. */
export type Section = string[] | string | false | null | undefined;

export interface Column {
  /** Fixed width in characters. Omit for a flexible column that takes the remaining space. */
  width?: number;
  align?: "left" | "right" | "center";
  /** Smallest width a flexible column may shrink to before the layout is rejected. */
  min?: number;
}

/** A cell may be one string or several paragraphs, each wrapped on its own line(s). */
export type Cell = string | string[] | undefined;

export interface Row {
  cells: Cell[];
  /** Pad the row to at least this many lines, e.g. space for a signature. */
  minLines?: number;
  /** Draw a rule above this row even when the table has no row rules. */
  ruleBefore?: boolean;
}

export interface TableOptions {
  header?: string[];
  /** Rule between every body row. Costs one line each in text mode, two dots in raster. */
  rowRules?: boolean;
  /** Use `=` for the closing rule, which marks the end of a totals block. */
  doubleEnd?: boolean;
}

// ---------------------------------------------------------------------------
// Text helpers

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/[‐-―−]/g, "-"],
  [/[·•‧]/g, "-"],
  [/[‘’‚]/g, "'"],
  [/[“”„]/g, '"'],
  [/…/g, "..."],
  [/×/g, "x"],
];

/** Collapse whitespace and keep only printable ASCII (the bridge prints ascii only). */
export function clean(text: unknown): string {
  let value = String(text ?? "");
  for (const [pattern, replacement] of REPLACEMENTS) value = value.replace(pattern, replacement);
  return value
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function wrap(text: unknown, width: number): string[] {
  const value = clean(text);
  if (!value) return [""];
  const words = value.split(" ").flatMap((word) => {
    const chunks: string[] = [];
    for (let start = 0; start < word.length; start += width)
      chunks.push(word.slice(start, start + width));
    return chunks;
  });
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function align(text: string, width: number, how: Column["align"] = "left") {
  if (how === "right") return text.padStart(width);
  if (how === "center") {
    const left = Math.floor((width - text.length) / 2);
    return (" ".repeat(left) + text).padEnd(width);
  }
  return text.padEnd(width);
}

export function centered(text: unknown, width: number): string[] {
  if (!clean(text)) return [];
  return wrap(text, width).map((line) => align(line, width, "center").trimEnd());
}

/** Left and right text on one plain line, falling back to two lines when it does not fit. */
export function spread(left: unknown, right: unknown, width: number): string[] {
  const l = clean(left);
  const r = clean(right);
  if (!r) return wrap(l, width);
  if (!l) return [r.padStart(width)];
  if (l.length + 1 + r.length <= width) return [l + " ".repeat(width - l.length - r.length) + r];
  return [...wrap(l, width), ...wrap(r, width).map((line) => line.padStart(width))];
}

// ---------------------------------------------------------------------------
// Tables

export function resolveColumns(columns: Column[], width: number): number[] {
  const borders = columns.length + 1;
  const fixed = columns.reduce((sum, column) => sum + (column.width ?? 0), 0);
  const flexible = columns.filter((column) => column.width === undefined);
  const free = width - borders - fixed;
  if (!flexible.length) {
    if (free !== 0) throw new Error(`TABLE_WIDTH_MISMATCH: ${fixed + borders} != ${width}`);
    return columns.map((column) => column.width!);
  }
  const share = Math.floor(free / flexible.length);
  let extra = free - share * flexible.length;
  return columns.map((column) => {
    if (column.width !== undefined) return column.width;
    const size = share + (extra-- > 0 ? 1 : 0);
    if (size < (column.min ?? 4)) throw new Error(`TABLE_TOO_NARROW: ${width}`);
    return size;
  });
}

export function ruleLine(widths: number[], char: "-" | "=" = "-"): string {
  return `+${widths.map((width) => char.repeat(width)).join("+")}+`;
}

export function rowLines(row: Row, widths: number[], columns: Column[]): string[] {
  const wrapped = widths.map((width, index) => {
    const value = row.cells[index];
    const paragraphs = Array.isArray(value) ? value : [value ?? ""];
    const lines = paragraphs.flatMap((paragraph) =>
      clean(paragraph) ? wrap(paragraph, width) : [],
    );
    return lines.length ? lines : [""];
  });
  const height = Math.max(row.minLines ?? 1, ...wrapped.map((lines) => lines.length));
  return Array.from(
    { length: height },
    (_, line) =>
      `|${widths
        .map((width, index) => align(wrapped[index][line] ?? "", width, columns[index].align))
        .join("|")}|`,
  );
}

export function table(
  width: number,
  columns: Column[],
  rows: Array<Row | Cell[]>,
  options: TableOptions = {},
): string[] {
  const widths = resolveColumns(columns, width);
  const normalised = rows.map((row) => (Array.isArray(row) ? { cells: row } : row));
  if (!normalised.length && !options.header) return [];
  const lines = [ruleLine(widths)];
  if (options.header) {
    lines.push(...rowLines({ cells: options.header }, widths, columns), ruleLine(widths));
  }
  normalised.forEach((row, index) => {
    if (index > 0 && (options.rowRules || row.ruleBefore)) lines.push(ruleLine(widths));
    lines.push(...rowLines(row, widths, columns));
  });
  lines.push(ruleLine(widths, options.doubleEnd ? "=" : "-"));
  return lines;
}

/** One full-width cell around some text: notes, banners, instructions. */
export function box(width: number, paragraphs: Cell[], minLines?: number): string[] {
  const content = paragraphs.filter((p) => (Array.isArray(p) ? p.length : clean(p)));
  if (!content.length) return [];
  const text = content.flatMap((p) => (Array.isArray(p) ? p : [p ?? ""]));
  return table(width, [{}], [{ cells: [text], minLines }]);
}

export function labelWidth(width: number): number {
  if (width >= 70) return 18;
  if (width >= 40) return 15;
  return 11;
}

export type Field = [label: string, value: Cell] | false | null | undefined;

function hasValue(value: Cell) {
  return Array.isArray(value) ? value.some((v) => clean(v)) : Boolean(clean(value));
}

/** Label | value rows. Rows without a value are dropped, so optional details never print blank. */
export function fields(
  width: number,
  entries: Field[],
  options: { keepEmpty?: string[] } = {},
): string[] {
  const rows = entries
    .filter((entry): entry is [string, Cell] => Boolean(entry))
    .filter(([label, value]) => hasValue(value) || options.keepEmpty?.includes(label))
    .map(([label, value]) => ({ cells: [label, value] }));
  return table(width, [{ width: labelWidth(width) }, { min: 8 }], rows);
}

/** Two label | value tables side by side on wide paper; stacked on thermal paper. */
export function fieldPanels(width: number, left: Field[], right: Field[]): string[] {
  if (width < 70) return [...fields(width, left), ...fields(width, right)];
  const present = (entry: Field): entry is [string, Cell] => Boolean(entry && hasValue(entry[1]));
  const a = left.filter(present);
  const b = right.filter(present);
  const rows = Array.from({ length: Math.max(a.length, b.length) }, (_, i) => ({
    cells: [a[i]?.[0], a[i]?.[1], b[i]?.[0], b[i]?.[1]],
  }));
  return table(width, [{ width: 12 }, {}, { width: 13 }, {}], rows);
}

/** Short "Label value" cells two to a row: compact headers for tickets. */
export function grid(width: number, cells: Array<string | false | null | undefined>): string[] {
  const values = cells.filter((cell): cell is string => Boolean(cell && clean(cell)));
  if (!values.length) return [];
  const rows: Cell[][] = [];
  for (let i = 0; i < values.length; i += 2) rows.push([values[i], values[i + 1] ?? ""]);
  return table(width, [{}, {}], rows);
}

/** Label rows with room to sign or write. */
export function signatures(width: number, labels: string[], lines = 2): string[] {
  return table(
    width,
    [{ width: labelWidth(width) }, { min: 8 }],
    labels.map((label) => ({ cells: [label, ""], minLines: lines })),
    { rowRules: true },
  );
}

// ---------------------------------------------------------------------------
// Composition

const RULE = /^\+[+\-=]+\+$/;

function mergeRules(a: string, b: string): string {
  if (a.length !== b.length) return a;
  const char = a.includes("=") || b.includes("=") ? "=" : "-";
  return [...a].map((c, i) => (c === "+" || b[i] === "+" ? "+" : char)).join("");
}

/**
 * Join sections into the final document and enforce the bridge's limits:
 * every line at most `width`, ruled lines exactly `width`, ascii only.
 */
export function compose(width: number, sections: Section[]): string {
  const lines: string[] = [];
  for (const section of sections) {
    if (!section) continue;
    for (const line of Array.isArray(section) ? section : section.split("\n")) {
      const previous = lines.at(-1);
      if (previous !== undefined && RULE.test(previous) && RULE.test(line)) {
        lines[lines.length - 1] = mergeRules(previous, line);
        continue;
      }
      lines.push(line.trimEnd());
    }
  }
  while (lines.length && !lines.at(-1)) lines.pop();
  for (const line of lines) {
    if (!/^[\x20-\x7e]*$/.test(line)) throw new Error(`NON_ASCII_LINE: ${line}`);
    if (line.length > width) throw new Error(`LINE_TOO_WIDE (${line.length}/${width}): ${line}`);
    if ((line.startsWith("+") || line.startsWith("|")) && line.length !== width)
      throw new Error(`RULED_LINE_WIDTH (${line.length}/${width}): ${line}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Money (amounts are major units, e.g. 2850.5 KES; maths is done in cents)

export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) throw new Error("INVALID_PRINT_AMOUNT");
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function money(amount: number): string {
  const cents = toCents(amount);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** Accounting style for deductions: (1,200.00). */
export function deduction(amount: number): string {
  return amount === 0 ? money(0) : `(${money(Math.abs(amount))})`;
}

export function sum(amounts: number[]): number {
  return fromCents(amounts.reduce((total, amount) => total + toCents(amount), 0));
}

export function times(quantity: number, unitPrice: number): number {
  return fromCents(Math.round(quantity * toCents(unitPrice)));
}

/** VAT contained in a VAT-inclusive amount, e.g. 16% of 2,850.00 incl. = 393.10. */
export function vatFromInclusive(amount: number, ratePercent: number): number {
  return fromCents(Math.round((toCents(amount) * ratePercent) / (100 + ratePercent)));
}

/** VAT charged on top of a VAT-exclusive amount. */
export function vatOnExclusive(amount: number, ratePercent: number): number {
  return fromCents(Math.round((toCents(amount) * ratePercent) / 100));
}

export function quantity(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
