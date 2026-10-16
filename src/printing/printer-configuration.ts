import { z } from "zod";
import { validateRenderProfile } from "../../printing-core/thermal-layout.mjs";

const rasterCapabilities = z
  .object({
    command: z.literal("GS_V_0"),
    printableWidthDots: z.number().int().min(256).max(832).multipleOf(8),
    dpi: z.union([z.literal(203), z.literal(300)]),
    maxBandHeight: z.number().int().min(16).max(256),
    maxHeightDots: z.number().int().min(256).max(32768),
    maxBytes: z.number().int().min(4096).max(1048576),
  })
  .strict();

export const printerConfigurationSchema = z
  .object({
    id: z.string().uuid().optional(),
    branchId: z.string().min(1).max(160),
    name: z.string().trim().min(2).max(160),
    bridgeId: z.string().trim().min(8).max(160),
    transport: z.enum(["WINDOWS", "TCP"]),
    osPrinterName: z.string().trim().max(200).optional(),
    host: z
      .string()
      .regex(/^[a-zA-Z0-9.:-]{1,253}$/)
      .optional(),
    port: z.number().int().min(1024).max(65535).default(9100),
    paperWidth: z.enum(["58mm", "80mm"]).default("80mm"),
    encoding: z.literal("ascii").default("ascii"),
    cutter: z.enum(["none", "partial", "full"]).default("none"),
    emphasis: z.boolean().default(false),
    renderingMode: z.enum(["TEXT_ESC_POS", "RASTER_ESC_POS"]).optional(),
    raster: rasterCapabilities.optional(),
    roles: z
      .array(
        z.enum(["FRONT", "BILL", "RECEIPT", "INVOICE", "KITCHEN", "BAR", "DISPATCH", "REPORT"]),
      )
      .min(1)
      .max(8),
    stations: z.array(z.string().trim().min(1).max(160)).max(32).default([]),
    fallbackPrinterId: z.string().uuid().optional(),
    copies: z.number().int().min(1).max(3).default(1),
    enabled: z.boolean().default(true),
    kitchenMode: z
      .enum(["PRINTER_ONLY", "KDS_ONLY", "KDS_AND_PRINTER", "NO_DEDICATED_KITCHEN_SYSTEM"])
      .default("PRINTER_ONLY"),
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      validateRenderProfile(value, value.transport);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Explicit supported TCP raster capabilities are required",
      });
    }
    if (
      (value.transport === "TCP" && !value.host) ||
      (value.transport === "WINDOWS" && !value.osPrinterName)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The selected transport requires a printer endpoint",
      });
    }
  });
export type PrinterConfiguration = z.infer<typeof printerConfigurationSchema>;

export function printerRenderingProfile(config: PrinterConfiguration, mode = config.renderingMode) {
  return {
    paperWidth: config.paperWidth,
    encoding: config.encoding,
    cutter: config.cutter,
    emphasis: config.emphasis,
    ...(mode ? { renderingMode: mode } : {}),
    ...(mode === "RASTER_ESC_POS" ? { raster: config.raster } : {}),
  };
}

export function printerTarget(config: PrinterConfiguration & { id: string }) {
  return {
    id: config.id,
    transport: config.transport,
    ...(config.transport === "TCP"
      ? { host: config.host, port: config.port }
      : { osPrinterName: config.osPrinterName }),
  };
}
