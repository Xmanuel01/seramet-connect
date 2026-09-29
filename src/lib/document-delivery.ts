import { ksh } from "@/data/mock";
import { branchHardwareProfiles } from "@/lib/seramet-print-service";

export type InvoiceLine = {
  description: string;
  quantity: number;
  unitPrice: number;
};

export type InvoiceDeliveryRecord = {
  id: string;
  customer: string;
  branch: string;
  issued: string;
  due: string;
  amount: number;
  paid: number;
  status: string;
  email?: string;
  phone?: string;
  lines?: InvoiceLine[];
};

export type DeliveryChannel = "PDF" | "Email" | "WhatsApp";

export type DeliveryLogEntry = {
  id: string;
  invoiceId: string;
  channel: DeliveryChannel;
  destination: string;
  createdAt: string;
  status: "Prepared" | "Opened";
};

const defaultLines: InvoiceLine[] = [
  { description: "Catering package", quantity: 1, unitPrice: 0 },
];

export function createInvoicePdfBlob(invoice: InvoiceDeliveryRecord) {
  return new Blob([createInvoicePdfBytes(invoice)], { type: "application/pdf" });
}

export function createInvoicePdfBytes(invoice: InvoiceDeliveryRecord) {
  const lines = renderInvoiceLines(invoice);
  const identity =
    branchHardwareProfiles[invoice.branch]?.printIdentity ??
    branchHardwareProfiles.Westlands.printIdentity;
  const outstanding = invoice.amount - invoice.paid;
  const content = [
    "BT",
    `/F1 18 Tf 50 790 Td (${pdfText(identity.businessName)}) Tj`,
    `/F1 16 Tf 385 0 Td (${pdfText("TAX INVOICE")}) Tj`,
    `/F1 10 Tf -385 -18 Td (${pdfText(identity.branchName)}) Tj`,
    `0 -14 Td (${pdfText(identity.address)}) Tj`,
    `0 -14 Td (${pdfText(`Tel: ${identity.phone}  Email: ${identity.email}`)}) Tj`,
    `0 -14 Td (${pdfText(`PIN: ${identity.pin}`)}) Tj`,
    `330 42 Td (${pdfText(invoice.id)}) Tj`,
    `0 -16 Td (${pdfText(`Date: ${invoice.issued}`)}) Tj`,
    `0 -16 Td (${pdfText(`Due Date: ${invoice.due}`)}) Tj`,
    `-330 -36 Td (${pdfText("BILL TO")}) Tj`,
    `0 -15 Td (${pdfText(invoice.customer)}) Tj`,
    `250 15 Td (${pdfText("SERVICE INFO")}) Tj`,
    `0 -15 Td (${pdfText(`Branch: ${invoice.branch}`)}) Tj`,
    `-250 -30 Td (${pdfText("QTY  DESCRIPTION                         UNIT PRICE     AMOUNT")}) Tj`,
    ...lines.map((line) => `0 -16 Td (${pdfText(line)}) Tj`),
    `0 -24 Td (${pdfText(`SUBTOTAL                                      ${ksh(invoice.amount)}`)}) Tj`,
    `0 -16 Td (${pdfText(`PAID                                          ${ksh(invoice.paid)}`)}) Tj`,
    `0 -16 Td (${pdfText(`OUTSTANDING                                   ${ksh(outstanding)}`)}) Tj`,
    `0 -16 Td (${pdfText(`STATUS                                        ${invoice.status}`)}) Tj`,
    `0 -28 Td (${pdfText("PAYMENT INFORMATION")}) Tj`,
    `0 -15 Td (${pdfText(`M-PESA TILL: ${identity.tillNumber}`)}) Tj`,
    `0 -15 Td (${pdfText(`BANK: ${identity.bankName}`)}) Tj`,
    `0 -15 Td (${pdfText(`A/C NAME: ${identity.bankAccountName}`)}) Tj`,
    `0 -15 Td (${pdfText(`A/C NO: ${identity.bankAccountNumber}`)}) Tj`,
    `320 45 Td (${pdfText("THANK YOU")}) Tj`,
    `0 -32 Td (${pdfText("Authorised Signatory")}) Tj`,
    "ET",
  ].join("\n");
  return buildPdf(content);
}

export function invoiceEmailLink(invoice: InvoiceDeliveryRecord) {
  const subject = encodeURIComponent(`Invoice ${invoice.id} from Mona Swahili`);
  const body = encodeURIComponent(invoiceDeliveryMessage(invoice, "email"));
  return `mailto:${invoice.email ?? ""}?subject=${subject}&body=${body}`;
}

export function invoiceWhatsAppLink(invoice: InvoiceDeliveryRecord) {
  const phone = (invoice.phone ?? "").replace(/\D/g, "");
  const text = encodeURIComponent(invoiceDeliveryMessage(invoice, "whatsapp"));
  return `https://wa.me/${phone}?text=${text}`;
}

export function invoiceDeliveryMessage(
  invoice: InvoiceDeliveryRecord,
  channel: "email" | "whatsapp",
) {
  const outstanding = invoice.amount - invoice.paid;
  const action =
    channel === "email" ? "Please find your invoice details below." : "Invoice details:";
  return [
    action,
    `Invoice: ${invoice.id}`,
    `Customer: ${invoice.customer}`,
    `Branch: ${invoice.branch}`,
    `Amount: ${ksh(invoice.amount)}`,
    `Outstanding: ${ksh(outstanding)}`,
    `Due: ${invoice.due}`,
    "PDF copy can be downloaded from Seramet.",
  ].join("\n");
}

export function createDeliveryLog(
  invoice: InvoiceDeliveryRecord,
  channel: DeliveryChannel,
  destination: string,
): DeliveryLogEntry {
  return {
    id: `DLV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase(),
    invoiceId: invoice.id,
    channel,
    destination,
    createdAt: new Date().toLocaleString("en-KE", { hour12: false }),
    status: "Opened",
  };
}

function renderInvoiceLines(invoice: InvoiceDeliveryRecord) {
  const sourceLines = invoice.lines?.length
    ? invoice.lines
    : defaultLines.map((line) => ({ ...line, unitPrice: invoice.amount }));
  return sourceLines.map((line) => {
    const description = `${line.quantity}    ${line.description}`.padEnd(38);
    const unit = ksh(line.unitPrice).padStart(12);
    const amount = ksh(line.quantity * line.unitPrice).padStart(12);
    return `${description}${unit}${amount}`;
  });
}

function buildPdf(content: string) {
  const encoder = new TextEncoder();
  const stream = encoder.encode(content);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return encoder.encode(pdf);
}

function pdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
