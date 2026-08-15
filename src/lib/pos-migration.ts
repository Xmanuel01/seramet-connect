export type PosMigrationEntity =
  | "Items"
  | "Categories"
  | "Prices"
  | "Customers"
  | "Suppliers"
  | "Opening Stock"
  | "Employees"
  | "Historical Sales";

export type PosMigrationFieldType = "text" | "number" | "money" | "boolean" | "date";

export type PosMigrationTargetField = {
  key: string;
  label: string;
  type: PosMigrationFieldType;
  required?: boolean;
};

export type PosMigrationProfile = {
  id: string;
  vendor: string;
  description: string;
  aliases: Record<PosMigrationEntity, Record<string, string[]>>;
};

export type PosMigrationColumnMapping = {
  targetField: string;
  sourceColumn?: string;
  confidence: number;
  required: boolean;
  status: "Mapped" | "Missing" | "Optional";
};

export type PosMigrationEntityPlan = {
  entity: PosMigrationEntity;
  sourceColumns: string[];
  rowCount: number;
  mappings: PosMigrationColumnMapping[];
  requiredMapped: number;
  requiredTotal: number;
  canImport: boolean;
};

export type PosMigrationPlan = {
  profileId: string;
  vendor: string;
  sourceName: string;
  entities: PosMigrationEntityPlan[];
  warnings: string[];
  canImport: boolean;
};

export type PosMigrationOverride = {
  entity: PosMigrationEntity;
  targetField: string;
  sourceColumn?: string;
};

type ParsedSheet = {
  name: string;
  columns: string[];
  rows: Record<string, string>[];
};

export const posMigrationTargetFields: Record<PosMigrationEntity, PosMigrationTargetField[]> = {
  Items: [
    { key: "itemCode", label: "Item Code", type: "text", required: true },
    { key: "name", label: "Item Name", type: "text", required: true },
    { key: "category", label: "Category", type: "text", required: true },
    { key: "sellingPrice", label: "Selling Price", type: "money", required: true },
    { key: "costPrice", label: "Cost Price", type: "money" },
    { key: "taxCategory", label: "Tax Category", type: "text" },
    { key: "productionStation", label: "Production Station", type: "text" },
    { key: "sku", label: "SKU", type: "text" },
    { key: "barcode", label: "Barcode", type: "text" },
    { key: "imageFilename", label: "Image Filename", type: "text" },
  ],
  Categories: [
    { key: "categoryCode", label: "Category Code", type: "text" },
    { key: "name", label: "Category Name", type: "text", required: true },
    { key: "menuSection", label: "Menu Section", type: "text" },
  ],
  Prices: [
    { key: "itemCode", label: "Item Code", type: "text", required: true },
    { key: "branch", label: "Branch", type: "text" },
    { key: "channel", label: "Channel", type: "text" },
    { key: "price", label: "Price", type: "money", required: true },
  ],
  Customers: [
    { key: "customerCode", label: "Customer Code", type: "text" },
    { key: "name", label: "Customer Name", type: "text", required: true },
    { key: "phone", label: "Phone", type: "text" },
    { key: "email", label: "Email", type: "text" },
    { key: "loyaltyPoints", label: "Loyalty Points", type: "number" },
  ],
  Suppliers: [
    { key: "supplierCode", label: "Supplier Code", type: "text" },
    { key: "name", label: "Supplier Name", type: "text", required: true },
    { key: "phone", label: "Phone", type: "text" },
    { key: "email", label: "Email", type: "text" },
    { key: "taxPin", label: "Tax PIN", type: "text" },
  ],
  "Opening Stock": [
    { key: "itemCode", label: "Item Code", type: "text", required: true },
    { key: "branch", label: "Branch", type: "text", required: true },
    { key: "quantity", label: "Quantity", type: "number", required: true },
    { key: "unitCost", label: "Unit Cost", type: "money" },
  ],
  Employees: [
    { key: "employeeCode", label: "Employee Code", type: "text" },
    { key: "name", label: "Employee Name", type: "text", required: true },
    { key: "role", label: "Role", type: "text", required: true },
    { key: "branch", label: "Branch", type: "text" },
    { key: "phone", label: "Phone", type: "text" },
  ],
  "Historical Sales": [
    { key: "orderId", label: "Order ID", type: "text", required: true },
    { key: "soldAt", label: "Sold At", type: "date", required: true },
    { key: "itemCode", label: "Item Code", type: "text" },
    { key: "customerCode", label: "Customer Code", type: "text" },
    { key: "branch", label: "Branch", type: "text" },
    { key: "quantity", label: "Quantity", type: "number", required: true },
    { key: "total", label: "Total", type: "money", required: true },
    { key: "paymentMethod", label: "Payment Method", type: "text" },
  ],
};

export const posMigrationProfiles: PosMigrationProfile[] = [
  {
    id: "generic-pos",
    vendor: "Generic POS export",
    description: "Flexible mapping for CSV/XLSX exports with common restaurant POS column names.",
    aliases: {
      Items: {
        itemCode: ["item code", "itemcode", "code", "plu", "product code", "productcode"],
        name: ["item name", "item", "name", "product", "product name", "description"],
        category: ["category", "department", "group", "menu group"],
        sellingPrice: ["selling price", "price", "unit price", "retail price", "amount"],
        costPrice: ["cost", "cost price", "unit cost"],
        taxCategory: ["tax", "tax category", "vat"],
        productionStation: ["station", "production station", "kitchen station", "printer group"],
        sku: ["sku", "stock keeping unit"],
        barcode: ["barcode", "ean", "upc"],
        imageFilename: ["image", "image filename", "image reference", "photo"],
      },
      Categories: {
        categoryCode: ["category code", "department code", "group code"],
        name: ["category", "category name", "department", "group"],
        menuSection: ["section", "menu section"],
      },
      Prices: {
        itemCode: ["item code", "itemcode", "sku", "plu"],
        branch: ["branch", "location", "outlet"],
        channel: ["channel", "order type"],
        price: ["price", "selling price", "branch price"],
      },
      Customers: {
        customerCode: ["customer code", "customer id", "member id"],
        name: ["customer", "customer name", "name"],
        phone: ["phone", "mobile", "telephone"],
        email: ["email", "email address"],
        loyaltyPoints: ["points", "loyalty points", "rewards"],
      },
      Suppliers: {
        supplierCode: ["supplier code", "vendor code", "supplier id"],
        name: ["supplier", "supplier name", "vendor", "vendor name"],
        phone: ["phone", "mobile", "telephone"],
        email: ["email", "email address"],
        taxPin: ["tax pin", "pin", "vat number"],
      },
      "Opening Stock": {
        itemCode: ["item code", "itemcode", "sku", "plu"],
        branch: ["branch", "location", "outlet", "warehouse"],
        quantity: ["quantity", "qty", "opening quantity", "stock on hand"],
        unitCost: ["unit cost", "cost", "average cost"],
      },
      Employees: {
        employeeCode: ["employee code", "staff id", "employee id"],
        name: ["employee", "employee name", "staff name", "name"],
        role: ["role", "job title", "position"],
        branch: ["branch", "location", "outlet"],
        phone: ["phone", "mobile", "telephone"],
      },
      "Historical Sales": {
        orderId: ["order id", "sale id", "receipt no", "ticket no"],
        soldAt: ["date", "sold at", "sale date", "created at", "time"],
        itemCode: ["item code", "itemcode", "sku", "plu"],
        customerCode: ["customer code", "customer id", "member id"],
        branch: ["branch", "location", "outlet"],
        quantity: ["quantity", "qty"],
        total: ["total", "amount", "gross sales", "net sales"],
        paymentMethod: ["payment", "payment method", "tender"],
      },
    },
  },
  {
    id: "toast-square-lightspeed",
    vendor: "Toast / Square / Lightspeed style",
    description:
      "Maps exports that use menu item, dining option, ticket, check, and location language.",
    aliases: {
      Items: {
        itemCode: ["sku", "plu", "menu item id", "item id"],
        name: ["menu item", "item name", "name"],
        category: ["menu", "category", "sales category"],
        sellingPrice: ["base price", "price", "gross price"],
        costPrice: ["food cost", "cost"],
        taxCategory: ["tax rate", "tax name"],
        productionStation: ["prep station", "routing group", "fulfillment station"],
        sku: ["sku"],
        barcode: ["gtin", "barcode"],
        imageFilename: ["image url", "photo url", "image filename"],
      },
      Categories: {
        categoryCode: ["category id", "menu id"],
        name: ["category", "sales category", "menu"],
        menuSection: ["menu group", "section"],
      },
      Prices: {
        itemCode: ["sku", "menu item id", "item id"],
        branch: ["location", "restaurant", "store"],
        channel: ["dining option", "fulfillment", "source"],
        price: ["price", "base price", "gross price"],
      },
      Customers: {
        customerCode: ["customer id", "guest id"],
        name: ["guest", "customer", "name"],
        phone: ["phone", "mobile phone"],
        email: ["email"],
        loyaltyPoints: ["loyalty balance", "points"],
      },
      Suppliers: {
        supplierCode: ["vendor id", "supplier id"],
        name: ["vendor", "supplier"],
        phone: ["vendor phone", "phone"],
        email: ["vendor email", "email"],
        taxPin: ["tax id", "tax pin"],
      },
      "Opening Stock": {
        itemCode: ["sku", "inventory item id", "item id"],
        branch: ["location", "store"],
        quantity: ["on hand", "stock on hand", "qty"],
        unitCost: ["average cost", "unit cost"],
      },
      Employees: {
        employeeCode: ["employee id", "staff id"],
        name: ["employee", "staff", "name"],
        role: ["job", "job title", "role"],
        branch: ["location", "store"],
        phone: ["phone"],
      },
      "Historical Sales": {
        orderId: ["check id", "ticket id", "ticket no", "order id", "receipt no"],
        soldAt: ["opened", "closed", "business date", "date"],
        itemCode: ["sku", "menu item id", "item id"],
        customerCode: ["guest id", "customer id"],
        branch: ["location", "store"],
        quantity: ["qty", "quantity"],
        total: ["net sales", "gross sales", "total"],
        paymentMethod: ["tender type", "payment method"],
      },
    },
  },
];

const entityKeywords: Record<PosMigrationEntity, string[]> = {
  Items: ["item", "menu", "product", "plu", "sku"],
  Categories: ["category", "department", "menu"],
  Prices: ["price", "pricing"],
  Customers: ["customer", "guest", "member"],
  Suppliers: ["supplier", "vendor"],
  "Opening Stock": ["stock", "inventory", "on hand", "opening"],
  Employees: ["employee", "staff", "user"],
  "Historical Sales": ["sales", "orders", "tickets", "receipts", "checks"],
};

export function createPosMigrationPlan(
  sheets: { name: string; columns: string[]; rows?: Record<string, string>[] }[],
  sourceName = "POS export",
  profile: PosMigrationProfile = posMigrationProfiles[0]!,
): PosMigrationPlan {
  const parsedSheets = sheets.map((sheet) => ({
    name: sheet.name,
    columns: sheet.columns,
    rows: sheet.rows ?? [],
  }));
  const entities = (Object.keys(posMigrationTargetFields) as PosMigrationEntity[]).map((entity) => {
    const sheet = bestSheetForEntity(entity, parsedSheets);
    const mappings = mapColumns(entity, sheet?.columns ?? [], profile);
    const requiredTotal = mappings.filter((mapping) => mapping.required).length;
    const requiredMapped = mappings.filter(
      (mapping) => mapping.required && mapping.status === "Mapped",
    ).length;
    return {
      entity,
      sourceColumns: sheet?.columns ?? [],
      rowCount: sheet?.rows.length ?? 0,
      mappings,
      requiredMapped,
      requiredTotal,
      canImport: requiredTotal > 0 && requiredMapped === requiredTotal,
    };
  });
  const warnings = entities
    .filter((entity) => !entity.canImport)
    .map(
      (entity) =>
        `${entity.entity}: ${entity.requiredTotal - entity.requiredMapped} required mapping${entity.requiredTotal - entity.requiredMapped === 1 ? "" : "s"} missing`,
    );
  return {
    profileId: profile.id,
    vendor: profile.vendor,
    sourceName,
    entities,
    warnings,
    canImport: entities.some((entity) => entity.canImport) && warnings.length === 0,
  };
}

export function previewPosMigrationCsv(
  text: string,
  sourceName = "POS export.csv",
  profile = posMigrationProfiles[0]!,
) {
  const sheet = parseCsvSheet(text, sourceName.replace(/\.[^.]+$/, "") || "POS export");
  return createPosMigrationPlan([sheet], sourceName, profile);
}

export function applyPosMigrationOverrides(
  plan: PosMigrationPlan,
  overrides: PosMigrationOverride[],
): PosMigrationPlan {
  const overrideMap = new Map(
    overrides.map((override) => [
      `${override.entity}:${override.targetField}`,
      override.sourceColumn ?? "",
    ]),
  );
  const entities = plan.entities.map((entity) => {
    const mappings = entity.mappings.map((mapping) => {
      const override = overrideMap.get(`${entity.entity}:${mapping.targetField}`);
      if (override === undefined) return mapping;
      const sourceColumn = entity.sourceColumns.find((column) => column === override);
      const { sourceColumn: _sourceColumn, ...baseMapping } = mapping;
      return {
        ...baseMapping,
        ...(sourceColumn ? { sourceColumn } : {}),
        confidence: sourceColumn ? 100 : 0,
        status: sourceColumn
          ? ("Mapped" as const)
          : mapping.required
            ? ("Missing" as const)
            : ("Optional" as const),
      };
    });
    const requiredTotal = mappings.filter((mapping) => mapping.required).length;
    const requiredMapped = mappings.filter(
      (mapping) => mapping.required && mapping.status === "Mapped",
    ).length;
    return {
      ...entity,
      mappings,
      requiredMapped,
      requiredTotal,
      canImport: requiredTotal > 0 && requiredMapped === requiredTotal,
    };
  });
  const warnings = entities
    .filter((entity) => !entity.canImport)
    .map(
      (entity) =>
        `${entity.entity}: ${entity.requiredTotal - entity.requiredMapped} required mapping${entity.requiredTotal - entity.requiredMapped === 1 ? "" : "s"} missing`,
    );
  return {
    ...plan,
    entities,
    warnings,
    canImport: entities.some((entity) => entity.canImport) && warnings.length === 0,
  };
}

export function migrationCoverage(plan: PosMigrationPlan) {
  const total = plan.entities.reduce((sum, entity) => sum + entity.mappings.length, 0);
  const mapped = plan.entities.reduce(
    (sum, entity) => sum + entity.mappings.filter((mapping) => mapping.status === "Mapped").length,
    0,
  );
  return {
    mapped,
    total,
    percent: total ? Math.round((mapped / total) * 100) : 0,
    importableEntities: plan.entities.filter((entity) => entity.canImport).length,
  };
}

function bestSheetForEntity(entity: PosMigrationEntity, sheets: ParsedSheet[]) {
  return [...sheets].sort((left, right) => scoreSheet(entity, right) - scoreSheet(entity, left))[0];
}

function scoreSheet(entity: PosMigrationEntity, sheet: ParsedSheet) {
  const haystack = [sheet.name, ...sheet.columns].map(normalize).join(" ");
  return (
    entityKeywords[entity].reduce(
      (score, keyword) => score + (haystack.includes(normalize(keyword)) ? 3 : 0),
      0,
    ) +
    posMigrationTargetFields[entity].reduce(
      (score, field) =>
        score +
        (sheet.columns.some(
          (column) =>
            normalize(column) === normalize(field.label) ||
            normalize(column) === normalize(field.key),
        )
          ? 2
          : 0),
      0,
    )
  );
}

function mapColumns(entity: PosMigrationEntity, columns: string[], profile: PosMigrationProfile) {
  return posMigrationTargetFields[entity].map((field) => {
    const aliases = [field.key, field.label, ...(profile.aliases[entity][field.key] ?? [])].map(
      normalize,
    );
    const matchedColumn = columns.find((column) => aliases.includes(normalize(column)));
    return {
      targetField: field.key,
      ...(matchedColumn ? { sourceColumn: matchedColumn } : {}),
      confidence: matchedColumn
        ? normalize(matchedColumn) === normalize(field.key) ||
          normalize(matchedColumn) === normalize(field.label)
          ? 100
          : 86
        : 0,
      required: field.required === true,
      status: matchedColumn
        ? ("Mapped" as const)
        : field.required
          ? ("Missing" as const)
          : ("Optional" as const),
    };
  });
}

function parseCsvSheet(text: string, name: string): ParsedSheet {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);

  const columns = (rows.shift() ?? []).map((value) => value.trim()).filter(Boolean);
  const dataRows = rows.map((values) =>
    Object.fromEntries(columns.map((column, index) => [column, values[index]?.trim() ?? ""])),
  );
  return { name, columns, rows: dataRows };
}

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
