export type RichPaper = "58mm" | "80mm";
export type RichStyle =
  | "title"
  | "status"
  | "orderNo"
  | "label"
  | "value"
  | "item"
  | "note"
  | "box"
  | "section"
  | "banner"
  | "name"
  | "nameSub"
  | "address"
  | "phone"
  | "docNo"
  | "infoLabel"
  | "infoValue"
  | "th"
  | "td"
  | "amountLabel"
  | "amount"
  | "grand"
  | "payHead"
  | "payText"
  | "pill"
  | "thanks"
  | "small";
export interface RichRun {
  s: RichStyle;
  text: string;
}
type Align = "left" | "center" | "right";
export type RichBlock =
  | { t: "gap"; h: number }
  | {
      t: "text";
      runs: RichRun[];
      align?: Align;
      indent?: number;
      hang?: number;
      leading?: number;
      pad?: number;
    }
  | { t: "rule"; style: "solid" | "dashed"; weight?: "heavy"; pad?: number }
  | { t: "spread"; left?: RichRun[]; right?: RichRun[]; rightBox?: boolean; pad?: number }
  | { t: "flanked"; runs: RichRun[]; tracking?: number; line?: number; pad?: number }
  | { t: "box"; runs: RichRun[]; align?: Align }
  | {
      t: "table";
      /** auto: sized to the widest header or value; others share the rest by weight. */
      cols: Array<{ w: number; align?: Align; auto?: boolean }>;
      head?: string[];
      rows: Array<Array<string | string[]>>;
    }
  | {
      t: "amounts";
      rows: Array<[string, string]>;
      labelEdge?: number;
      label?: RichStyle;
      amount?: RichStyle;
    }
  | {
      t: "columns";
      cols: Array<{ w: number; blocks: RichBlock[]; valign?: "top" | "middle" }>;
      divider?: boolean;
      gap?: number;
    }
  | { t: "qr"; modules: string[]; size?: number; align?: Align };
export interface RichDocument {
  v: 1;
  paper: RichPaper;
  blocks: RichBlock[];
}
export interface RichBitmap {
  width: number;
  height: number;
  data: Uint8Array;
}
export const RICH_DOCUMENT_VERSION: 1;
export const RICH_STYLES: Record<RichPaper, Record<RichStyle, [string, number]>>;
export function richText(value: unknown): string;
export function validateRichDocument(doc: unknown): asserts doc is RichDocument;
export function renderRichDocument(doc: RichDocument, widthDots: number): RichBitmap;
export function renderRichForProfile(
  doc: RichDocument,
  raster: { printableWidthDots: number; dpi?: number },
): RichBitmap;
export function richBands(
  bitmap: RichBitmap,
  maxBandHeight: number,
): Generator<{ width: number; height: number; start: number; data: Uint8Array }>;
