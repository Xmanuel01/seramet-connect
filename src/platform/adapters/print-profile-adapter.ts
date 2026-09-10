import type {
  BranchCapability,
  BranchHardwareProfile,
  BranchPrintIdentity,
  KitchenOperatingMode,
  PrintDocumentType,
  PrinterDevice,
  PrinterRole,
  PrintTemplateSettings,
  ProductionStation,
} from "@/lib/seramet-print-service";
import {
  getConfigurationRepository,
  PlatformConfigurationError,
} from "@/platform/repositories/configuration-repository";
import type {
  BusinessDocumentIdentity,
  DocumentTemplateConfiguration,
  HardwareDevice,
  PrinterOutputRole,
} from "@/platform/types";

const printDocumentTypes: PrintDocumentType[] = [
  "BILL",
  "RECEIPT",
  "INVOICE",
  "FOOD_KOT",
  "BAR_TICKET",
  "DISPATCH_TICKET",
  "KDS_TICKET",
  "REPORT",
];

const customerDocumentTypes = ["BILL", "RECEIPT", "INVOICE"] as const;

const capabilityKeys: BranchCapability[] = [
  "POS_ENABLED",
  "TABLE_SERVICE",
  "KDS_ENABLED",
  "KITCHEN_PRINTING",
  "BAR_PRINTING",
  "RESERVATIONS",
  "TAKEAWAY",
  "DELIVERY",
  "ONLINE_ORDERS",
  "LOYALTY",
  "CUSTOMER_DISPLAY",
  "BAR_MODULE",
  "RECEIPT_PRINTING",
  "INVOICE_PRINTING",
];

export function getConfiguredBranchHardwareProfile(
  branchIdOrName: string,
  tenantId?: string,
): BranchHardwareProfile {
  const repository = getConfigurationRepository();
  const resolved = resolveBranch(branchIdOrName, tenantId);
  const branch = resolved.branch;
  const tenant = repository.getTenant(resolved.tenantId);
  const identity = repository.getDocumentIdentity(resolved.tenantId, branch.id);
  const devices = repository.listDevices(resolved.tenantId, branch.id);
  const routes = repository.listPrintRoutes(resolved.tenantId, branch.id);
  const templates = repository.listDocumentTemplates(resolved.tenantId, branch.id);
  const metadata = branch.metadata;
  const kitchenMode = readKitchenMode(metadata["kitchenMode"]);
  const capabilities = readCapabilities(metadata["capabilities"]);
  const posTerminals = readPositiveInteger(metadata["posTerminals"], "POS terminal count");

  if (devices.length === 0) {
    throw new PlatformConfigurationError(`No hardware devices configured for ${branch.name}`);
  }
  if (routes.length === 0) {
    throw new PlatformConfigurationError(`No printer routes configured for ${branch.name}`);
  }

  const printers = devices.map((device) => toPrinterDevice(device, branch.name, routes));
  const templateSettings = Object.fromEntries(
    customerDocumentTypes.map((documentType) => {
      const configured = findTemplate(templates, documentType);
      return [documentType, toTemplateSettings(configured, identity)];
    }),
  ) as BranchHardwareProfile["templateSettings"];

  const documentRoutes = Object.fromEntries(
    printDocumentTypes.map((documentType) => {
      const configured = routes.find(
        (route) => normalizeDocumentType(route.documentType) === documentType,
      );
      if (!configured) {
        throw new PlatformConfigurationError(
          `No ${documentType.replaceAll("_", " ").toLowerCase()} printer route configured for ${branch.name}`,
        );
      }
      const primary = devices.find((device) => device.id === configured.primaryDeviceId);
      if (!primary) {
        throw new PlatformConfigurationError(
          `Printer route ${configured.id} has no primary device`,
        );
      }
      const fallback = configured.fallbackDeviceId
        ? devices.find((device) => device.id === configured.fallbackDeviceId)
        : undefined;
      const template = findTemplate(templates, templateDocumentType(documentType));
      return [
        documentType,
        {
          primaryRole: documentRole(documentType),
          ...(fallback ? { fallbackRole: preferredRole(fallback.outputRoles, documentType) } : {}),
          copies: configured.copies,
          template: `${template.id}-${template.width}`,
        },
      ];
    }),
  ) as BranchHardwareProfile["documentRoutes"];

  return {
    tenantId: resolved.tenantId,
    branchId: branch.id,
    branch: branch.name,
    printIdentity: toPrintIdentity(identity, branch.name, branch.timezone ?? tenant.timezone),
    posTerminals,
    kitchenMode,
    capabilities,
    printers,
    stationRoutes: buildStationRoutes(resolved.tenantId, branch.id),
    documentRoutes,
    templateSettings,
  };
}

export function getConfiguredBranchHardwareProfiles() {
  const repository = getConfigurationRepository();
  const snapshot = repository.snapshot();
  return Object.fromEntries(
    snapshot.branches
      .filter((branch) => branch.active)
      .map((branch) => [
        branch.name,
        getConfiguredBranchHardwareProfile(branch.id, branch.tenantId),
      ]),
  );
}

export function getConfiguredPrintTemplates() {
  const repository = getConfigurationRepository();
  const snapshot = repository.snapshot();
  const tenant = snapshot.tenants.find((item) => item.active);
  const branch = tenant
    ? snapshot.branches.find((item) => item.tenantId === tenant.id && item.active)
    : undefined;
  if (!tenant || !branch) throw new PlatformConfigurationError("Business profile not configured");
  const identity = repository.getDocumentIdentity(tenant.id, branch.id);
  const templates = repository.listDocumentTemplates(tenant.id, branch.id);
  return Object.fromEntries(
    customerDocumentTypes.map((documentType) => [
      documentType,
      toTemplateSettings(findTemplate(templates, documentType), identity),
    ]),
  ) as Record<(typeof customerDocumentTypes)[number], PrintTemplateSettings>;
}

export function saveConfiguredBranchHardwareProfile(profile: BranchHardwareProfile) {
  const repository = getConfigurationRepository();
  const branch = repository.getBranch(profile.tenantId, profile.branchId);
  repository.upsertBranch(profile.tenantId, {
    ...branch,
    metadata: {
      ...branch.metadata,
      kitchenMode: profile.kitchenMode,
      posTerminals: profile.posTerminals,
      capabilities: profile.capabilities,
    },
  });

  const existingIdentity = repository.getDocumentIdentity(profile.tenantId, profile.branchId);
  repository.upsertDocumentIdentity(profile.tenantId, {
    ...existingIdentity,
    businessName: profile.printIdentity.businessName,
    address: profile.printIdentity.address,
    phone: profile.printIdentity.phone,
    email: profile.printIdentity.email,
    taxNumber: profile.printIdentity.pin,
    footerMessage: profile.printIdentity.footerMessage,
    paymentInstructions: paymentInstructions(profile.printIdentity),
    metadata: {
      ...existingIdentity.metadata,
      receiptBrand: profile.printIdentity.receiptBrand,
      payment: {
        tillNumber: profile.printIdentity.tillNumber,
        bankName: profile.printIdentity.bankName,
        bankAccountName: profile.printIdentity.bankAccountName,
        bankAccountNumber: profile.printIdentity.bankAccountNumber,
      },
    },
  });

  profile.printers.forEach((printer) => {
    const current = repository
      .listDevices(profile.tenantId, profile.branchId)
      .find((device) => device.id === printer.id);
    repository.upsertDevice(profile.tenantId, {
      id: printer.id,
      tenantId: profile.tenantId,
      branchId: profile.branchId,
      name: printer.name,
      deviceType: current?.deviceType ?? "PRINTER",
      connectionType: current?.connectionType ?? "OS_PRINTER",
      driver: current?.driver ?? "Configured printer driver",
      address: current?.address ?? printer.name,
      enabled: true,
      healthStatus:
        printer.connection === "Connected"
          ? "ONLINE"
          : printer.connection === "Degraded"
            ? "DEGRADED"
            : "OFFLINE",
      outputRoles: rolesToOutputRoles(printer.roles),
      metadata: {
        ...(current?.metadata ?? {}),
        lastPrintAt: printer.lastPrintAt,
        queue: printer.queue,
        failures: printer.failures,
      },
    });
  });

  Object.values(profile.templateSettings).forEach((template) => {
    const current = repository
      .listDocumentTemplates(profile.tenantId, profile.branchId)
      .find((candidate) => candidate.id === template.id);
    repository.upsertDocumentTemplate(profile.tenantId, {
      id: current?.id ?? template.id,
      tenantId: profile.tenantId,
      branchId: profile.branchId,
      documentType: template.documentType,
      width: template.width,
      copies: template.copies,
      showLogo: current?.showLogo ?? true,
      showBranch: template.showBranch,
      showCashier: template.showCashier,
      showCustomer: template.showCustomer,
      showTax: template.showTax,
      showPayment: template.showPayment,
      showQrCode: template.showQrCode,
      footerMessage: template.footerMessage,
      layoutVersion: current?.layoutVersion ?? "seramet-v1",
      active: true,
    });
  });

  Object.entries(profile.documentRoutes).forEach(([documentType, route]) => {
    const primary = profile.printers.find((printer) => printer.roles.includes(route.primaryRole));
    if (!primary) {
      throw new PlatformConfigurationError(
        `No device is assigned to ${route.primaryRole} for ${documentType}`,
      );
    }
    const fallback = route.fallbackRole
      ? profile.printers.find((printer) => printer.roles.includes(route.fallbackRole!))
      : undefined;
    const storedDocumentType = templateDocumentType(documentType as PrintDocumentType);
    const current = repository
      .listPrintRoutes(profile.tenantId, profile.branchId)
      .find((candidate) => normalizeDocumentType(candidate.documentType) === documentType);
    repository.upsertPrintRoute(profile.tenantId, {
      id: current?.id ?? `route-${profile.branchId}-${storedDocumentType.toLowerCase()}`,
      tenantId: profile.tenantId,
      branchId: profile.branchId,
      documentType: storedDocumentType,
      ...(current?.stationId ? { stationId: current.stationId } : {}),
      primaryDeviceId: primary.id,
      ...(fallback ? { fallbackDeviceId: fallback.id } : {}),
      copies: route.copies,
      enabled: true,
    });
  });
  return getConfiguredBranchHardwareProfile(profile.branchId, profile.tenantId);
}

function resolveBranch(branchIdOrName: string, tenantId?: string) {
  const repository = getConfigurationRepository();
  if (tenantId) return { tenantId, branch: repository.resolveBranch(tenantId, branchIdOrName) };
  const matches = repository
    .snapshot()
    .branches.filter(
      (branch) =>
        branch.active &&
        (branch.id.toLowerCase() === branchIdOrName.toLowerCase() ||
          branch.name.toLowerCase() === branchIdOrName.toLowerCase()),
    );
  if (matches.length !== 1) {
    throw new PlatformConfigurationError(
      matches.length === 0 ? "No active branch" : "Branch reference is ambiguous across tenants",
    );
  }
  const branch = matches[0]!;
  return { tenantId: branch.tenantId, branch };
}

function readKitchenMode(value: unknown): KitchenOperatingMode {
  const modes: KitchenOperatingMode[] = [
    "KDS_ONLY",
    "PRINTER_ONLY",
    "KDS_AND_PRINTER",
    "NO_DEDICATED_KITCHEN_SYSTEM",
  ];
  if (!modes.includes(value as KitchenOperatingMode)) {
    throw new PlatformConfigurationError("Kitchen operating mode is not configured");
  }
  return value as KitchenOperatingMode;
}

function readCapabilities(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new PlatformConfigurationError("Branch capabilities are not configured");
  }
  const source = value as Record<string, unknown>;
  return Object.fromEntries(capabilityKeys.map((key) => [key, source[key] === true])) as Record<
    BranchCapability,
    boolean
  >;
}

function readPositiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new PlatformConfigurationError(`${label} is not configured`);
  }
  return parsed;
}

function normalizeDocumentType(documentType: string): PrintDocumentType {
  const normalized = documentType.trim().toUpperCase();
  if (["KOT", "KITCHEN_KOT", "FOOD_KOT"].includes(normalized)) return "FOOD_KOT";
  if (["BAR", "BAR_ORDER", "BAR_TICKET"].includes(normalized)) return "BAR_TICKET";
  if (["DISPATCH", "DISPATCH_TICKET"].includes(normalized)) return "DISPATCH_TICKET";
  if (["KDS", "KDS_TICKET"].includes(normalized)) return "KDS_TICKET";
  if (printDocumentTypes.includes(normalized as PrintDocumentType)) {
    return normalized as PrintDocumentType;
  }
  throw new PlatformConfigurationError(`Unsupported print document type ${documentType}`);
}

function templateDocumentType(documentType: PrintDocumentType) {
  if (documentType === "FOOD_KOT") return "KOT";
  return documentType;
}

function findTemplate(templates: DocumentTemplateConfiguration[], documentType: string) {
  const template = templates.find(
    (item) => item.documentType.toUpperCase() === documentType.toUpperCase(),
  );
  if (!template) {
    throw new PlatformConfigurationError(
      `No ${documentType.replaceAll("_", " ").toLowerCase()} document template configured`,
    );
  }
  return template;
}

function documentRole(documentType: PrintDocumentType): PrinterRole {
  const roles: Record<PrintDocumentType, PrinterRole> = {
    BILL: "BILL",
    RECEIPT: "RECEIPT",
    INVOICE: "INVOICE",
    FOOD_KOT: "KITCHEN",
    BAR_TICKET: "BAR",
    DISPATCH_TICKET: "DISPATCH",
    KDS_TICKET: "KDS",
    REPORT: "REPORT",
  };
  return roles[documentType];
}

function preferredRole(outputRoles: PrinterOutputRole[], documentType: PrintDocumentType) {
  const routeRole = documentRole(documentType);
  const candidates = outputRoles.flatMap(outputRoleToPrinterRoles);
  return candidates.includes(routeRole) ? routeRole : (candidates[0] ?? "FRONT");
}

function outputRoleToPrinterRoles(outputRole: PrinterOutputRole): PrinterRole[] {
  const mapping: Record<PrinterOutputRole, PrinterRole[]> = {
    CUSTOMER_DOCUMENT: ["FRONT", "RECEIPT", "BILL", "INVOICE"],
    KITCHEN: ["KITCHEN"],
    BAR: ["BAR"],
    OFFICE: ["INVOICE"],
    REPORT: ["REPORT"],
    LABEL: [],
    DISPATCH: ["DISPATCH"],
  };
  return mapping[outputRole];
}

function toPrinterDevice(
  device: HardwareDevice,
  branchName: string,
  routes: ReturnType<ReturnType<typeof getConfigurationRepository>["listPrintRoutes"]>,
): PrinterDevice {
  const routeRoles = routes
    .filter((route) => route.primaryDeviceId === device.id)
    .map((route) => documentRole(normalizeDocumentType(route.documentType)));
  const fallbackPrinterId = routes.find(
    (route) => route.primaryDeviceId === device.id && route.fallbackDeviceId,
  )?.fallbackDeviceId;
  return {
    id: device.id,
    name: device.name,
    branch: branchName,
    roles: Array.from(
      new Set([...device.outputRoles.flatMap(outputRoleToPrinterRoles), ...routeRoles]),
    ),
    connection:
      device.healthStatus === "ONLINE"
        ? "Connected"
        : device.healthStatus === "DEGRADED"
          ? "Degraded"
          : "Offline",
    lastPrintAt: String(device.metadata["lastPrintAt"] ?? "Never"),
    queue: Number(device.metadata["queue"] ?? 0),
    failures: Number(device.metadata["failures"] ?? 0),
    ...(fallbackPrinterId ? { fallbackPrinterId } : {}),
  };
}

function toTemplateSettings(
  template: DocumentTemplateConfiguration,
  identity: BusinessDocumentIdentity,
): PrintTemplateSettings {
  const documentType = template.documentType.toUpperCase() as "BILL" | "RECEIPT" | "INVOICE";
  return {
    id: template.id,
    label:
      documentType === "BILL"
        ? "Customer bill"
        : documentType === "RECEIPT"
          ? "Paid receipt"
          : "Tax invoice",
    documentType,
    width: template.width,
    copies: template.copies,
    logoText: String(identity.metadata["receiptBrand"] ?? identity.businessName),
    showBranch: template.showBranch,
    showCashier: template.showCashier,
    showCustomer: template.showCustomer,
    showTax: template.showTax,
    showPayment: template.showPayment,
    showQrCode: template.showQrCode,
    footerMessage: template.footerMessage,
  };
}

function toPrintIdentity(
  identity: BusinessDocumentIdentity,
  branchName: string,
  timeZone: string,
): BranchPrintIdentity {
  const payment =
    identity.metadata["payment"] && typeof identity.metadata["payment"] === "object"
      ? (identity.metadata["payment"] as Record<string, unknown>)
      : {};
  return {
    businessName: identity.businessName,
    receiptBrand: String(identity.metadata["receiptBrand"] ?? identity.businessName),
    branchName,
    address: identity.address,
    phone: identity.phone,
    email: identity.email,
    pin: identity.taxNumber,
    tillNumber: String(payment["tillNumber"] ?? ""),
    bankName: String(payment["bankName"] ?? ""),
    bankAccountName: String(payment["bankAccountName"] ?? ""),
    bankAccountNumber: String(payment["bankAccountNumber"] ?? ""),
    paymentInstructions: [...identity.paymentInstructions],
    timeZone,
    footerMessage: identity.footerMessage,
  };
}

function buildStationRoutes(tenantId: string, branchId: string) {
  const stations = getConfigurationRepository()
    .snapshot()
    .stations.filter(
      (station) => station.tenantId === tenantId && station.branchId === branchId && station.active,
    );
  const roleFor = (station: (typeof stations)[number] | undefined): PrinterRole => {
    if (station?.stationType === "BAR") return "BAR";
    if (station?.stationType === "DISPATCH" || station?.stationType === "PASS") return "DISPATCH";
    return "KITCHEN";
  };
  const find = (station: ProductionStation) =>
    stations.find(
      (item) =>
        item.code.replaceAll("-", " ").toUpperCase() === station ||
        item.name.toUpperCase() === station ||
        item.stationType === station,
    );
  return {
    "MAIN KITCHEN": roleFor(
      stations.find((station) => station.stationType === "KITCHEN") ?? find("MAIN KITCHEN"),
    ),
    GRILL: roleFor(find("GRILL")),
    BAR: roleFor(find("BAR")),
    DESSERT: roleFor(find("DESSERT")),
    DISPATCH: roleFor(find("DISPATCH")),
    NONE: "FRONT",
  } satisfies Record<ProductionStation, PrinterRole>;
}

function rolesToOutputRoles(roles: PrinterRole[]) {
  const outputRoles = new Set<PrinterOutputRole>();
  roles.forEach((role) => {
    if (["FRONT", "RECEIPT", "BILL"].includes(role)) outputRoles.add("CUSTOMER_DOCUMENT");
    if (role === "INVOICE") outputRoles.add("OFFICE");
    if (role === "KITCHEN") outputRoles.add("KITCHEN");
    if (role === "BAR") outputRoles.add("BAR");
    if (role === "DISPATCH") outputRoles.add("DISPATCH");
    if (role === "REPORT") outputRoles.add("REPORT");
  });
  return Array.from(outputRoles);
}

function paymentInstructions(identity: BranchPrintIdentity) {
  return [
    identity.tillNumber ? `Till: ${identity.tillNumber}` : "",
    identity.bankName ? `Bank: ${identity.bankName}` : "",
    identity.bankAccountName ? `A/C Name: ${identity.bankAccountName}` : "",
    identity.bankAccountNumber ? `A/C No: ${identity.bankAccountNumber}` : "",
  ].filter(Boolean);
}
