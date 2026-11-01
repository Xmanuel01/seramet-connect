import type { Paper } from "./ruled";

/** Dates and times arrive already formatted in the branch's time zone. */
export type DisplayTime = string;

export interface PrintContext {
  paper: Paper;
  /** Currency shown in totals labels. Amounts themselves print without a symbol. */
  currency?: string;
  /** Set for any print after the first. Prints a REPRINT line so copies can't pass as originals. */
  copy?: { number?: number; at: DisplayTime; by?: string };
}

export interface BusinessIdentity {
  name: string;
  branch?: string;
  address?: string;
  phone?: string;
  email?: string;
  /** KRA PIN or equivalent tax id. */
  taxPin?: string;
}

export interface Party {
  name: string;
  address?: string;
  taxPin?: string;
  contact?: string;
}

export interface SaleLine {
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers?: string[];
  note?: string;
}

export interface ProductionLine {
  name: string;
  quantity: number;
  modifiers?: string[];
  note?: string;
}

export interface Payment {
  method: string;
  amount: number;
  reference?: string;
}

/** Restaurant-level tax settings, so the same templates work with or without VAT. */
export interface TaxSettings {
  vatRegistered: boolean;
  /** Prices on the menu already include VAT (usual for restaurants). */
  pricesIncludeVat?: boolean;
  vatRate?: number;
  /** Extra levies such as Kenya's 2% catering levy, applied on the VAT-exclusive amount. */
  levies?: Array<{ label: string; ratePercent: number }>;
}

/**
 * eTIMS status for one document. Omit entirely when a restaurant has eTIMS
 * switched off: the eTIMS block then never prints.
 */
export type EtimsStatus =
  | {
      status: "SIGNED";
      cuSerial: string;
      cuInvoiceNumber: string;
      /** Verification URL KRA returns; printed as the QR code. */
      verifyUrl?: string;
      /** For credit notes: the CU number of the invoice being credited. */
      relatedCuInvoiceNumber?: string;
    }
  | { status: "PENDING"; queuedAt?: DisplayTime };

export interface MobileMoneyDetails {
  till?: string;
  paybill?: string;
  /** Account number customers enter; usually the bill or invoice number. */
  account?: string;
  /** Dynamic QR payload carrying till/paybill, account and amount. */
  qrPayload?: string;
}

export interface QrCode {
  payload: string;
  caption: string;
  purpose: "PAYMENT" | "ETIMS_VERIFY";
}

/**
 * A rendered document. `content` is the ruled text the bridge prints.
 * `qrCodes` are printed after the content by a QR-capable renderer; text and
 * raster printers without QR support simply skip them, and the content still
 * carries the manual payment or verification details.
 */
export interface PrintedDocument {
  kind: PrintableDocumentKind;
  paper: Paper;
  content: string;
  qrCodes: QrCode[];
}

export type PrintableDocumentKind =
  | "KOT"
  | "BOT"
  | "BILL"
  | "RECEIPT"
  | "TAX_INVOICE"
  | "PAYMENT_RECEIPT"
  | "CREDIT_NOTE"
  | "VOID_TICKET"
  | "AMENDMENT_TICKET"
  | "DISPATCH_TICKET"
  | "RIDER_CASH_SLIP"
  | "X_REPORT"
  | "Z_REPORT"
  | "PURCHASE_ORDER"
  | "GOODS_RECEIVED_NOTE"
  | "STOCK_TRANSFER_NOTE";
