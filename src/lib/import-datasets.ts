export type ImportFieldType = "text" | "number" | "date" | "boolean";

export type ImportField = {
  key: string;
  label: string;
  type: ImportFieldType;
  required?: boolean;
  hint?: string;
};

export type ImportDatasetId =
  | "menu"
  | "inventory"
  | "accounting"
  | "finance"
  | "crm"
  | "hr";

export type ImportDataset = {
  id: ImportDatasetId;
  label: string;
  module: string;
  description: string;
  target: string;
  fields: ImportField[];
  sampleCsv: string;
};

export const importDatasets: ImportDataset[] = [
  {
    id: "menu",
    label: "Menu & Recipes",
    module: "Sell",
    target: "Menu items, prices and station routing",
    description:
      "Item master with category, price, prep time and per-branch pricing. Accepts POS exports, supplier menu PDFs and photographed price lists.",
    fields: [
      { key: "name", label: "Item name", type: "text", required: true },
      { key: "category", label: "Category", type: "text", required: true },
      { key: "price", label: "Price (KSh)", type: "number", required: true },
      { key: "prep", label: "Prep minutes", type: "number" },
      { key: "productionStation", label: "Production station", type: "text" },
      { key: "sku", label: "SKU", type: "text" },
    ],
    sampleCsv: `name,category,price,prep,productionStation,sku
Chicken Shawarma,Main Meals,850,14,MAIN KITCHEN,FOOD-001
Tamarind Juice,Drinks,260,3,BAR,DRINK-004`,
  },
  {
    id: "inventory",
    label: "Inventory & Stock",
    module: "Inventory",
    target: "Item master, opening stock and PAR levels",
    description:
      "Stock items with unit, cost, opening quantity and reorder levels. Use for opening balances, stock counts and supplier catalogues.",
    fields: [
      { key: "sku", label: "SKU", type: "text", required: true },
      { key: "item", label: "Item", type: "text", required: true },
      { key: "unit", label: "Unit", type: "text", required: true },
      { key: "quantity", label: "Quantity", type: "number", required: true },
      { key: "unitCost", label: "Unit cost", type: "number" },
      { key: "par", label: "PAR level", type: "number" },
      { key: "branch", label: "Branch", type: "text" },
    ],
    sampleCsv: `sku,item,unit,quantity,unitCost,par,branch
RAW-014,Chicken breast,kg,42,620,60,Westlands
RAW-021,Basmati rice,kg,110,190,120,Ngong Road`,
  },
  {
    id: "accounting",
    label: "Accounting & Ledger",
    module: "Accounting",
    target: "Journal entries and chart of accounts",
    description:
      "Double-entry journal lines with account code, debit and credit. Accepts accountant workbooks and scanned ledger statements.",
    fields: [
      { key: "date", label: "Date", type: "date", required: true },
      { key: "accountCode", label: "Account code", type: "text", required: true },
      { key: "accountName", label: "Account name", type: "text" },
      { key: "description", label: "Narration", type: "text" },
      { key: "debit", label: "Debit", type: "number" },
      { key: "credit", label: "Credit", type: "number" },
      { key: "costCentre", label: "Cost centre", type: "text" },
    ],
    sampleCsv: `date,accountCode,accountName,description,debit,credit,costCentre
2026-08-01,4000,Food Sales,Z-report Westlands,0,184500,FOH
2026-08-01,1000,Cash on hand,Z-report Westlands,184500,0,FOH`,
  },
  {
    id: "finance",
    label: "Finance & Banking",
    module: "Finance",
    target: "Bank statements, expenses and supplier invoices",
    description:
      "Transaction lines for reconciliation: date, reference, counterparty, amount and channel. Bank PDFs and M-Pesa statements are OCR-read.",
    fields: [
      { key: "date", label: "Date", type: "date", required: true },
      { key: "reference", label: "Reference", type: "text", required: true },
      { key: "counterparty", label: "Counterparty", type: "text" },
      { key: "amount", label: "Amount", type: "number", required: true },
      { key: "direction", label: "Money in / out", type: "text" },
      { key: "channel", label: "Channel", type: "text" },
    ],
    sampleCsv: `date,reference,counterparty,amount,direction,channel
2026-08-01,MPE8H2K01,Mama Mboga Supplies,18400,out,M-Pesa
2026-08-02,BNK-99120,Equity settlement,242100,in,Bank`,
  },
  {
    id: "crm",
    label: "CRM & Customers",
    module: "Customers",
    target: "Customer records, loyalty and pipeline",
    description:
      "Customer master with contact, segment, loyalty tier and lifetime value. Accepts spreadsheets, loyalty exports and scanned sign-up sheets.",
    fields: [
      { key: "name", label: "Customer", type: "text", required: true },
      { key: "phone", label: "Phone", type: "text", required: true },
      { key: "email", label: "Email", type: "text" },
      { key: "segment", label: "Segment", type: "text" },
      { key: "loyaltyTier", label: "Loyalty tier", type: "text" },
      { key: "lifetimeValue", label: "Lifetime value", type: "number" },
      { key: "lastVisit", label: "Last visit", type: "date" },
    ],
    sampleCsv: `name,phone,email,segment,loyaltyTier,lifetimeValue,lastVisit
Achieng Otieno,+254712000111,achieng@example.com,Regular,Gold,184000,2026-08-10
Brian Kimani,+254733000222,,Corporate,Silver,92500,2026-08-12`,
  },
  {
    id: "hr",
    label: "HR & Payroll",
    module: "People",
    target: "Employee directory, contracts and payroll inputs",
    description:
      "Staff records with role, branch, contract type and pay. Accepts HR workbooks, signed contracts (PDF) and photographed muster rolls.",
    fields: [
      { key: "staffNumber", label: "Staff number", type: "text", required: true },
      { key: "name", label: "Full name", type: "text", required: true },
      { key: "role", label: "Role", type: "text", required: true },
      { key: "branch", label: "Branch", type: "text" },
      { key: "contract", label: "Contract type", type: "text" },
      { key: "grossPay", label: "Gross pay", type: "number" },
      { key: "startDate", label: "Start date", type: "date" },
    ],
    sampleCsv: `staffNumber,name,role,branch,contract,grossPay,startDate
EMP-014,Faith Wanjiru,Waiter,Westlands,Permanent,32000,2024-05-06
EMP-027,Peter Omondi,Line Cook,Ngong Road,Permanent,41000,2023-11-20`,
  },
];

export function getImportDataset(id: ImportDatasetId) {
  return importDatasets.find((dataset) => dataset.id === id) ?? importDatasets[0]!;
}
