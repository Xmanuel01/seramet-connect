import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  dataUrl: z.string().min(16),
  datasetLabel: z.string().min(1),
  columns: z.array(z.string().min(1)).min(1),
});

export type DocumentExtractResult = {
  ok: boolean;
  csv: string;
  notes: string;
  model: string;
  error?: string;
};

const model = "google/gemini-3.6-flash";

export const extractDocumentTable = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<DocumentExtractResult> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) {
      return {
        ok: false,
        csv: "",
        notes: "",
        model,
        error: "Document reading is not configured for this workspace.",
      };
    }

    const isPdf = data.mimeType.includes("pdf") || data.fileName.toLowerCase().endsWith(".pdf");
    const mediaBlock = isPdf
      ? { type: "file", file: { filename: data.fileName, file_data: data.dataUrl } }
      : { type: "image_url", image_url: { url: data.dataUrl } };

    const instruction = [
      `Extract every ${data.datasetLabel} data row from this document into CSV.`,
      `Use exactly this header row: ${data.columns.join(",")}`,
      "Rules: output CSV only, no prose, no code fences.",
      "Quote any value containing a comma. Leave a cell empty when the document does not state it.",
      "Numbers must be plain digits without currency symbols or thousand separators.",
      "Ignore page headers, footers, totals and subtotal rows.",
    ].join(" ");

    let response: Response;
    try {
      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: instruction }, mediaBlock],
            },
          ],
        }),
      });
    } catch {
      return { ok: false, csv: "", notes: "", model, error: "Could not reach the document reader." };
    }

    if (!response.ok) {
      const body = await response.text();
      const message =
        response.status === 429
          ? "The document reader is busy right now. Try again in a moment."
          : response.status === 402
            ? "Document reading credits are exhausted. Top up to continue."
            : response.status === 403
              ? "Document reading is disabled for this workspace."
              : `Document reading failed (${response.status}). ${body.slice(0, 200)}`;
      return { ok: false, csv: "", notes: "", model, error: message };
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = payload.choices?.[0]?.message?.content ?? "";
    const csv = raw
      .replace(/^```[a-zA-Z]*\s*/m, "")
      .replace(/```\s*$/m, "")
      .trim();

    if (!csv) {
      return {
        ok: false,
        csv: "",
        notes: "",
        model,
        error: "No table could be read from this document.",
      };
    }

    return {
      ok: true,
      csv,
      notes: `${isPdf ? "PDF text + OCR" : "Image OCR"} extraction of ${data.fileName}`,
      model,
    };
  });
