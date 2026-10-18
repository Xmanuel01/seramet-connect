export interface ThermalLayout {
  version: 1;
  renderer: "SERAMET_5X8_adafruit-e6ffe30f00a6_V1";
  columns: 32 | 42;
  rows: Array<{
    kind: "text" | "rule" | "table";
    text: string;
    borders: number[];
    strong: boolean;
  }>;
}
export function buildThermalLayout(content: string, paperWidth: "58mm" | "80mm"): ThermalLayout;
export function isStrongLine(line: string, index: number): boolean;
export function validateRenderProfile(profile: unknown, transport?: string): void;
export function rasterMetrics(
  layout: ThermalLayout,
  profile: unknown,
): {
  heights: number[];
  height: number;
  stride: number;
  bands: number;
  bytes: number;
  lineHeight: number;
};
export function validateRenderJob(job: unknown): void;
