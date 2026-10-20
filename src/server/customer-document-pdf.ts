import { PDFDocument, StandardFonts } from "pdf-lib";

// Use existing rendered document rows and amounts, not a second financial calculation.
export async function renderCustomerDocumentPdf(content: string, issuedAt: string) {
  const pdf = await PDFDocument.create();
  const stamp = new Date(issuedAt);
  if (!Number.isFinite(stamp.getTime())) throw new Error("DOCUMENT_DATE_INVALID");
  pdf.setCreationDate(stamp);
  pdf.setModificationDate(stamp);
  const font = await pdf.embedFont(StandardFonts.Courier);
  let page = pdf.addPage([595, 842]);
  let y = 802;
  const safe = content.replace(
    /[^\x20-\x7e\n\r]/g,
    (character) => `[U+${character.codePointAt(0)!.toString(16).toUpperCase()}]`,
  );
  for (const source of safe.split(/\r?\n/)) {
    for (const text of source.match(/.{1,90}/g) ?? [""]) {
      if (y < 40) {
        page = pdf.addPage([595, 842]);
        y = 802;
      }
      page.drawText(text, { x: 32, y, size: 9.5, font });
      y -= 13;
    }
  }
  return pdf.save({ useObjectStreams: false });
}
