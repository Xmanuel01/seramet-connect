import { ksh, type Product } from "@/data/mock";

export type PrinterRole =
  "FRONT" | "RECEIPT" | "BILL" | "INVOICE" | "KITCHEN" | "BAR" | "DISPATCH" | "REPORT" | "KDS";
export type PrintDocumentType =
  | "BILL"
  | "RECEIPT"
  | "INVOICE"
  | "FOOD_KOT"
  | "BAR_TICKET"
  | "DISPATCH_TICKET"
  | "KDS_TICKET"
  | "REPORT";
export type PrintJobStatus =
  | "Queued"
  | "Sending"
  | "Printed"
  | "Displayed"
  | "Failed"
  | "Retrying"
  | "Fallback Printed"
  | "Cancelled";
export type KitchenTicketDelivery = "KDS_DISPLAY" | "PRODUCTION_PRINT" | "POS_FRONT_PRINT";
export type PrinterConnection = "Connected" | "Offline" | "Degraded";
export type KitchenOperatingMode =
  "KDS_ONLY" | "PRINTER_ONLY" | "KDS_AND_PRINTER" | "NO_DEDICATED_KITCHEN_SYSTEM";
export type ProductionStation = NonNullable<Product["productionStation"]>;
export type BranchCapability =
  | "POS_ENABLED"
  | "TABLE_SERVICE"
  | "KDS_ENABLED"
  | "KITCHEN_PRINTING"
  | "BAR_PRINTING"
  | "RESERVATIONS"
  | "TAKEAWAY"
  | "DELIVERY"
  | "ONLINE_ORDERS"
  | "LOYALTY"
  | "CUSTOMER_DISPLAY"
  | "BAR_MODULE"
  | "RECEIPT_PRINTING"
  | "INVOICE_PRINTING";

export type BranchPrintIdentity = {
  businessName: string;
  receiptBrand: string;
  branchName: string;
  address: string;
  phone: string;
  email: string;
  pin: string;
  tillNumber: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  footerMessage: string;
};

export type PrinterDevice = {
  id: string;
  name: string;
  branch: string;
  roles: PrinterRole[];
  connection: PrinterConnection;
  lastPrintAt: string;
  queue: number;
  failures: number;
  fallbackPrinterId?: string;
};

export type BranchHardwareProfile = {
  branch: string;
  printIdentity: BranchPrintIdentity;
  posTerminals: number;
  kitchenMode: KitchenOperatingMode;
  capabilities: Record<BranchCapability, boolean>;
  printers: PrinterDevice[];
  stationRoutes: Record<ProductionStation, PrinterRole>;
  documentRoutes: Record<
    PrintDocumentType,
    {
      primaryRole: PrinterRole;
      fallbackRole?: PrinterRole;
      copies: number;
      template: string;
    }
  >;
};

export type PrintTemplateSettings = {
  id: string;
  label: string;
  documentType: "BILL" | "RECEIPT" | "INVOICE";
  width: "58mm" | "80mm" | "A4";
  copies: number;
  logoText: string;
  showBranch: boolean;
  showCashier: boolean;
  showCustomer: boolean;
  showTax: boolean;
  showPayment: boolean;
  showQrCode: boolean;
  showKotPrices?: boolean;
  footerMessage: string;
};

export type OrderLineForPrint = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unitPrice: number;
  productionStation: ProductionStation;
  modifiers?: string[];
  itemNote?: string;
};

export type OrderForPrint = {
  orderId: string;
  branch: string;
  terminalId: string;
  table?: string;
  orderType: string;
  requestedBy: string;
  cashier: string;
  waiter: string;
  createdAt: string;
  lines: OrderLineForPrint[];
  subtotal: number;
  tax: number;
  total: number;
  paid?: number;
  change?: number;
  paymentMethod?: string;
  customer?: string;
  customerPhone?: string;
  customerEmail?: string;
  kitchenNote?: string;
  receiptNumber?: string;
  invoiceNumber?: string;
  tillNumber?: string;
  paymentReference?: string;
  paymentBreakdown?: { method: string; amount: number; reference?: string }[];
};

export type PrintJob = {
  id: string;
  branch: string;
  orderId: string;
  documentType: PrintDocumentType;
  destination: PrinterRole;
  printerId: string;
  fallbackPrinterId?: string;
  createdAt: string;
  requestedBy: string;
  copies: number;
  status: PrintJobStatus;
  retryCount: number;
  printedAt?: string;
  failureReason?: string;
  template: string;
  content: string;
  duplicateKey: string;
  reprintOfJobId?: string;
  productionStation?: ProductionStation;
  kitchenTicketId?: string;
  kitchenTicketRecordId?: string;
  kitchenDelivery?: KitchenTicketDelivery;
  amendmentType?: "NEW" | "ADDITION" | "VOID" | "REPRINT";
};

export type PrintPlanResult = {
  jobs: PrintJob[];
  skipped: string[];
};

export type ReprintLogEntry = {
  id: string;
  jobId: string;
  originalJobId: string;
  orderId: string;
  branch: string;
  documentType: PrintDocumentType;
  requestedBy: string;
  reason: string;
  createdAt: string;
  status: "Logged" | "Duplicate blocked";
};

export type ReprintResult = {
  job?: PrintJob;
  log: ReprintLogEntry;
  skipped?: string;
};

export type PrintBridgeStatus = {
  id: string;
  name: string;
  version: string;
  machine: string;
  online: boolean;
  authenticated: boolean;
  lastHeartbeat: string;
  acceptedJobs: number;
  rejectedJobs: number;
  supportedConnections: string[];
};

export type BridgeSubmitResult = {
  accepted: boolean;
  bridgeJobId?: string;
  spoolPath?: string;
  message: string;
};

export type KitchenAnalyticsAdjustment = {
  mode: KitchenOperatingMode;
  label: string;
  captureMethod: string;
  confidence: "High" | "Medium" | "Low";
  ticketTimeMultiplier: number;
  lateTicketMultiplier: number;
  remakeVisibility: "Live" | "Print queue" | "Manual";
  notes: string[];
};

const nowStamp = () => new Date().toLocaleString("en-KE", { hour12: false });

const makeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();

const enabledCapabilities: Record<BranchCapability, boolean> = {
  POS_ENABLED: true,
  TABLE_SERVICE: true,
  KDS_ENABLED: true,
  KITCHEN_PRINTING: true,
  BAR_PRINTING: true,
  RESERVATIONS: true,
  TAKEAWAY: true,
  DELIVERY: true,
  ONLINE_ORDERS: true,
  LOYALTY: true,
  CUSTOMER_DISPLAY: true,
  BAR_MODULE: true,
  RECEIPT_PRINTING: true,
  INVOICE_PRINTING: true,
};

const compactBranchCapabilities: Record<BranchCapability, boolean> = {
  POS_ENABLED: true,
  TABLE_SERVICE: true,
  KDS_ENABLED: false,
  KITCHEN_PRINTING: true,
  BAR_PRINTING: true,
  RESERVATIONS: false,
  TAKEAWAY: true,
  DELIVERY: false,
  ONLINE_ORDERS: false,
  LOYALTY: true,
  CUSTOMER_DISPLAY: false,
  BAR_MODULE: false,
  RECEIPT_PRINTING: true,
  INVOICE_PRINTING: true,
};

export const documentTemplates: Record<"BILL" | "RECEIPT" | "INVOICE", PrintTemplateSettings> = {
  BILL: {
    id: "thermal-bill-80mm",
    label: "Customer bill",
    documentType: "BILL",
    width: "80mm",
    copies: 1,
    logoText: "SERAMET",
    showBranch: true,
    showCashier: true,
    showCustomer: false,
    showTax: true,
    showPayment: false,
    showQrCode: true,
    footerMessage: "Thank you for your business!",
  },
  RECEIPT: {
    id: "thermal-receipt-80mm",
    label: "Paid receipt",
    documentType: "RECEIPT",
    width: "80mm",
    copies: 1,
    logoText: "SERAMET",
    showBranch: true,
    showCashier: true,
    showCustomer: false,
    showTax: true,
    showPayment: true,
    showQrCode: true,
    footerMessage: "Thank you for dining with us.",
  },
  INVOICE: {
    id: "invoice-a4",
    label: "Tax invoice",
    documentType: "INVOICE",
    width: "A4",
    copies: 1,
    logoText: "SERAMET BUSINESS OS",
    showBranch: true,
    showCashier: true,
    showCustomer: true,
    showTax: true,
    showPayment: true,
    showQrCode: true,
    footerMessage: "Formal invoice for accounting/legal use.",
  },
};

let bridgeCounters = { acceptedJobs: 0, rejectedJobs: 0, authenticated: true };

export const serametPrintBridge: PrintBridgeStatus = {
  id: "SERAMET-BRIDGE-LOCAL-01",
  name: "Seramet Local Print Bridge",
  version: "1.0.0",
  machine: "Front counter Windows terminal",
  online: true,
  authenticated: true,
  lastHeartbeat: "Now",
  acceptedJobs: 0,
  rejectedJobs: 0,
  supportedConnections: ["USB", "LAN", "Bluetooth", "Windows spooler"],
};

export const branchHardwareProfiles: Record<string, BranchHardwareProfile> = {
  Westlands: {
    branch: "Westlands",
    printIdentity: {
      businessName: "Mona Swahili",
      receiptBrand: "SERAMET",
      branchName: "Westlands",
      address: "Kipro Centre, Sports Road",
      phone: "0719 427 919",
      email: "info@monaswahili.co.ke",
      pin: "P051234567G",
      tillNumber: "4235484",
      bankName: "KCB Bank",
      bankAccountName: "Mona Swahili Ltd",
      bankAccountNumber: "1234567890",
      footerMessage: "Different Flavours, One Promise.",
    },
    posTerminals: 2,
    kitchenMode: "KDS_AND_PRINTER",
    capabilities: enabledCapabilities,
    printers: [
      {
        id: "WEST-FRONT-01",
        name: "EPSON TM-T20 Front",
        branch: "Westlands",
        roles: ["FRONT", "RECEIPT", "BILL", "INVOICE", "BAR", "REPORT"],
        connection: "Connected",
        lastPrintAt: "2 min ago",
        queue: 0,
        failures: 0,
      },
      {
        id: "WEST-KITCHEN-01",
        name: "EPSON TM-U220 Kitchen",
        branch: "Westlands",
        roles: ["KITCHEN", "DISPATCH"],
        connection: "Connected",
        lastPrintAt: "4 min ago",
        queue: 0,
        failures: 0,
        fallbackPrinterId: "WEST-FRONT-01",
      },
    ],
    stationRoutes: {
      "MAIN KITCHEN": "KITCHEN",
      GRILL: "KITCHEN",
      BAR: "BAR",
      DESSERT: "KITCHEN",
      DISPATCH: "DISPATCH",
      NONE: "FRONT",
    },
    documentRoutes: {
      BILL: { primaryRole: "BILL", copies: 1, template: "thermal-bill-80mm" },
      RECEIPT: { primaryRole: "RECEIPT", copies: 1, template: "thermal-receipt-80mm" },
      INVOICE: { primaryRole: "INVOICE", fallbackRole: "FRONT", copies: 1, template: "invoice-a4" },
      FOOD_KOT: {
        primaryRole: "KITCHEN",
        fallbackRole: "FRONT",
        copies: 1,
        template: "kot-station-ticket",
      },
      BAR_TICKET: {
        primaryRole: "BAR",
        fallbackRole: "FRONT",
        copies: 1,
        template: "bar-station-ticket",
      },
      DISPATCH_TICKET: {
        primaryRole: "DISPATCH",
        fallbackRole: "FRONT",
        copies: 1,
        template: "dispatch-ticket",
      },
      KDS_TICKET: { primaryRole: "KDS", copies: 1, template: "kds-display-card" },
      REPORT: {
        primaryRole: "REPORT",
        fallbackRole: "FRONT",
        copies: 1,
        template: "manager-report",
      },
    },
  },
  "Ngong Road": {
    branch: "Ngong Road",
    printIdentity: {
      businessName: "Mona Swahili",
      receiptBrand: "SERAMET",
      branchName: "Ngong Road",
      address: "Ngong Road Branch",
      phone: "0719 427 919",
      email: "info@monaswahili.co.ke",
      pin: "P051234567G",
      tillNumber: "4235484",
      bankName: "KCB Bank",
      bankAccountName: "Mona Swahili Ltd",
      bankAccountNumber: "1234567890",
      footerMessage: "Different Flavours, One Promise.",
    },
    posTerminals: 1,
    kitchenMode: "PRINTER_ONLY",
    capabilities: compactBranchCapabilities,
    printers: [
      {
        id: "NGONG-THERMAL-01",
        name: "Generic Thermal Printer",
        branch: "Ngong Road",
        roles: ["FRONT", "RECEIPT", "BILL", "INVOICE", "KITCHEN", "BAR", "DISPATCH", "REPORT"],
        connection: "Connected",
        lastPrintAt: "1 min ago",
        queue: 0,
        failures: 0,
      },
    ],
    stationRoutes: {
      "MAIN KITCHEN": "KITCHEN",
      GRILL: "KITCHEN",
      BAR: "BAR",
      DESSERT: "KITCHEN",
      DISPATCH: "DISPATCH",
      NONE: "FRONT",
    },
    documentRoutes: {
      BILL: { primaryRole: "BILL", copies: 1, template: "thermal-bill-58mm" },
      RECEIPT: { primaryRole: "RECEIPT", copies: 1, template: "thermal-receipt-58mm" },
      INVOICE: { primaryRole: "INVOICE", copies: 1, template: "invoice-a4" },
      FOOD_KOT: { primaryRole: "KITCHEN", copies: 1, template: "kot-single-printer" },
      BAR_TICKET: { primaryRole: "BAR", copies: 1, template: "bar-single-printer" },
      DISPATCH_TICKET: { primaryRole: "DISPATCH", copies: 1, template: "dispatch-single-printer" },
      KDS_TICKET: { primaryRole: "KDS", copies: 1, template: "kds-display-card" },
      REPORT: { primaryRole: "REPORT", copies: 1, template: "manager-report" },
    },
  },
};

type RouteResolution = {
  destination: PrinterRole;
  printer?: PrinterDevice;
  fallbackPrinter?: PrinterDevice;
  routeMode: "primary" | "fallback" | "failed";
  failureReason?: string;
  route: BranchHardwareProfile["documentRoutes"][PrintDocumentType];
};

export const SerametPrintService = {
  getBranchHardwareProfile(branch: string) {
    return branchHardwareProfiles[branch] ?? branchHardwareProfiles.Westlands;
  },

  getBranchCapabilities(branch: string) {
    return this.getBranchHardwareProfile(branch).capabilities;
  },

  resolvePrinter(
    profile: BranchHardwareProfile,
    documentType: PrintDocumentType,
    productionStation?: ProductionStation,
  ): RouteResolution {
    const route = profile.documentRoutes[documentType];
    const onePrinter =
      profile.printers.filter((printer) => printer.connection !== "Offline").length === 1;
    const destination = productionStation
      ? profile.stationRoutes[productionStation]
      : route.primaryRole;
    const primaryRole = onePrinter
      ? (profile.printers.find((printer) => printer.connection !== "Offline")?.roles[0] ??
        route.primaryRole)
      : destination;
    const configuredPrimary = findPrinterByRole(profile, primaryRole);
    const primary = configuredPrimary ?? findPrinterByRole(profile, route.primaryRole);
    const fallbackByRoute = route.fallbackRole
      ? findPrinterByRole(profile, route.fallbackRole)
      : undefined;
    const fallbackByDevice = primary?.fallbackPrinterId
      ? profile.printers.find((printer) => printer.id === primary.fallbackPrinterId)
      : undefined;
    const fallbackPrinter = fallbackByRoute ?? fallbackByDevice;

    if (primary?.connection === "Connected" || primary?.connection === "Degraded") {
      return { destination, printer: primary, fallbackPrinter, routeMode: "primary", route };
    }
    if (fallbackPrinter && fallbackPrinter.connection !== "Offline") {
      return { destination, printer: primary, fallbackPrinter, routeMode: "fallback", route };
    }
    if (primary) {
      return {
        destination,
        printer: primary,
        fallbackPrinter,
        routeMode: "failed",
        failureReason: `${primary.name} is ${primary.connection.toLowerCase()} and no fallback printer is available`,
        route,
      };
    }
    return {
      destination,
      routeMode: "failed",
      failureReason: `No printer is mapped for ${destination}`,
      route,
    };
  },

  createDocumentJob(
    profile: BranchHardwareProfile,
    order: OrderForPrint,
    documentType: "BILL" | "RECEIPT" | "INVOICE",
  ): PrintJob {
    const resolution = this.resolvePrinter(profile, documentType);
    return createJob({
      profile,
      order,
      documentType,
      resolution,
      content: renderCustomerDocument(
        documentType,
        order,
        documentTemplates[documentType],
        profile,
      ),
    });
  },

  createProductionTicketJobs(
    profile: BranchHardwareProfile,
    order: OrderForPrint,
    existingJobs: PrintJob[],
    amendmentType: "NEW" | "ADDITION" | "VOID" | "REPRINT" = "NEW",
  ): PrintPlanResult {
    const groups = groupProductionLines(order.lines);
    const jobs: PrintJob[] = [];
    const skipped: string[] = [];

    groups.forEach((lines, station) => {
      const ticketId = `KT-${order.orderId.replace(/[^A-Z0-9]/gi, "")}-${station.replace(/[^A-Z0-9]/gi, "")}`;
      const ticketRecordId = `KTR-${order.branch.replace(/[^A-Z0-9]/gi, "")}-${ticketId}`;
      const duplicateKey = `PRODUCTION:${order.branch}:${ticketId}:${amendmentType}`;
      const duplicate = existingJobs.some(
        (job) => job.duplicateKey === duplicateKey && job.amendmentType === amendmentType,
      );
      if (duplicate && amendmentType === "NEW") {
        skipped.push(`${ticketId} already exists`);
        return;
      }
      const kitchenTicketId =
        amendmentType === "NEW"
          ? ticketId
          : `${ticketId}-${amendmentType}-${Date.now().toString(36)}`;
      const printDocumentType = productionDocumentType(station);
      const deliveries = productionDeliveriesForMode(profile.kitchenMode);

      deliveries.forEach((delivery) => {
        const documentType = delivery === "KDS_DISPLAY" ? "KDS_TICKET" : printDocumentType;
        const resolution =
          delivery === "POS_FRONT_PRINT"
            ? resolveFrontProductionPrinter(profile, documentType)
            : this.resolvePrinter(profile, documentType, station);
        jobs.push(
          createJob({
            profile,
            order,
            documentType,
            productionStation: station,
            kitchenTicketId,
            kitchenTicketRecordId: ticketRecordId,
            kitchenDelivery: delivery,
            amendmentType,
            resolution,
            content: renderProductionTicket(
              documentType,
              order,
              station,
              lines,
              amendmentType,
              profile,
            ),
            duplicateKey,
          }),
        );
      });
    });

    return { jobs, skipped };
  },

  createReprintJob(
    profile: BranchHardwareProfile,
    original: PrintJob,
    requestedBy: string,
    reason: string,
    existingJobs: PrintJob[],
  ): ReprintResult {
    const duplicateKey = `REPRINT:${original.id}:${original.orderId}`;
    const duplicate = existingJobs.some(
      (job) =>
        job.duplicateKey === duplicateKey && (job.status === "Queued" || job.status === "Retrying"),
    );
    const logBase = {
      id: makeId("RPL"),
      originalJobId: original.id,
      orderId: original.orderId,
      branch: original.branch,
      documentType: original.documentType,
      requestedBy,
      reason,
      createdAt: nowStamp(),
    };

    if (duplicate) {
      return {
        log: {
          ...logBase,
          jobId: original.id,
          status: "Duplicate blocked",
        },
        skipped: `A reprint for ${original.id} is already queued`,
      };
    }

    const resolution = this.resolvePrinter(
      profile,
      original.documentType,
      original.productionStation,
    );
    const assignedPrinter =
      resolution.routeMode === "fallback" ? resolution.fallbackPrinter : resolution.printer;
    const reprint = stripUndefined({
      ...original,
      id: makeId("RP"),
      createdAt: nowStamp(),
      requestedBy,
      printerId: assignedPrinter?.id ?? resolution.printer?.id ?? original.printerId,
      fallbackPrinterId:
        resolution.routeMode === "fallback" ? resolution.fallbackPrinter?.id : undefined,
      status: "Queued" as const,
      retryCount: 0,
      printedAt: undefined,
      failureReason: resolution.routeMode === "failed" ? resolution.failureReason : undefined,
      content: [
        "*** DUPLICATE COPY ***",
        `Original job: ${original.id}`,
        `Reason: ${reason}`,
        "---",
        original.content,
      ].join("\n"),
      duplicateKey,
      reprintOfJobId: original.id,
      kitchenTicketId: original.kitchenTicketId
        ? `${original.kitchenTicketId}-REPRINT-${Date.now().toString(36)}`
        : undefined,
      amendmentType: original.amendmentType ? ("REPRINT" as const) : undefined,
    });

    return {
      job: reprint,
      log: {
        ...logBase,
        jobId: reprint.id,
        status: "Logged",
      },
    };
  },

  processQueuedJobs(jobs: PrintJob[]) {
    return jobs.map((job) => {
      if (job.status !== "Queued" && job.status !== "Retrying") return job;
      if (!job.printerId) {
        return failJob(job, "No printer was assigned");
      }
      if (job.printerId === "KDS-DISPLAY") {
        return {
          ...job,
          status: "Displayed" as const,
          printedAt: nowStamp(),
        };
      }
      const bridgeResult = SerametLocalPrintBridge.submitJob(job);
      if (!bridgeResult.accepted) {
        return failJob(job, bridgeResult.message);
      }
      if (job.fallbackPrinterId && job.status !== "Retrying") {
        return {
          ...job,
          status: "Fallback Printed" as const,
          printedAt: nowStamp(),
        };
      }
      if (job.failureReason) {
        return failJob(job, job.failureReason);
      }
      return {
        ...job,
        status: "Printed" as const,
        printedAt: nowStamp(),
      };
    });
  },

  retryJob(profile: BranchHardwareProfile, jobs: PrintJob[], jobId: string) {
    const next = jobs.map((job) => {
      if (job.id !== jobId || (job.status !== "Failed" && job.status !== "Cancelled")) return job;
      const resolution = this.resolvePrinter(profile, job.documentType, job.productionStation);
      const retried = {
        ...job,
        status: "Retrying" as const,
        retryCount: job.retryCount + 1,
        printerId: resolution.fallbackPrinter?.id ?? resolution.printer?.id ?? job.printerId,
        fallbackPrinterId:
          resolution.routeMode === "fallback" ? resolution.fallbackPrinter?.id : undefined,
        failureReason: resolution.routeMode === "failed" ? resolution.failureReason : undefined,
      };
      return stripUndefined(retried);
    });
    return this.processQueuedJobs(next);
  },

  printAtFallback(profile: BranchHardwareProfile, jobs: PrintJob[], jobId: string) {
    return jobs
      .map((job) => {
        if (job.id !== jobId) return job;
        const route = profile.documentRoutes[job.documentType];
        const fallback =
          (route.fallbackRole ? findPrinterByRole(profile, route.fallbackRole) : undefined) ??
          profile.printers.find((printer) => printer.id === job.fallbackPrinterId) ??
          findPrinterByRole(profile, "FRONT");
        if (!fallback || fallback.connection === "Offline") {
          return failJob(job, "Fallback printer is not available");
        }
        return {
          ...job,
          fallbackPrinterId: fallback.id,
          status: "Fallback Printed" as const,
          printedAt: nowStamp(),
          retryCount: job.retryCount + 1,
          failureReason: undefined,
        };
      })
      .map(stripUndefined);
  },

  cancelJob(jobs: PrintJob[], jobId: string) {
    return jobs.map((job) => (job.id === jobId ? { ...job, status: "Cancelled" as const } : job));
  },

  getKitchenAnalyticsAdjustment(profile: BranchHardwareProfile): KitchenAnalyticsAdjustment {
    const adjustments: Record<KitchenOperatingMode, KitchenAnalyticsAdjustment> = {
      KDS_ONLY: {
        mode: "KDS_ONLY",
        label: "KDS only",
        captureMethod: "KDS touch events",
        confidence: "High",
        ticketTimeMultiplier: 0.92,
        lateTicketMultiplier: 0.78,
        remakeVisibility: "Live",
        notes: [
          "Start, bump and serve times are captured from KDS events.",
          "Printer latency is excluded from ticket-time calculations.",
        ],
      },
      PRINTER_ONLY: {
        mode: "PRINTER_ONLY",
        label: "Printer only",
        captureMethod: "Print queue and POS serve actions",
        confidence: "Medium",
        ticketTimeMultiplier: 1.08,
        lateTicketMultiplier: 1.18,
        remakeVisibility: "Print queue",
        notes: [
          "Ticket start time comes from print acceptance.",
          "Ready and serve events rely on POS or manager confirmation.",
        ],
      },
      KDS_AND_PRINTER: {
        mode: "KDS_AND_PRINTER",
        label: "KDS and printer",
        captureMethod: "KDS lifecycle plus printer acknowledgement",
        confidence: "High",
        ticketTimeMultiplier: 1,
        lateTicketMultiplier: 1,
        remakeVisibility: "Live",
        notes: [
          "KDS lifecycle is reconciled with printer delivery.",
          "Fallback prints are included in station pressure.",
        ],
      },
      NO_DEDICATED_KITCHEN_SYSTEM: {
        mode: "NO_DEDICATED_KITCHEN_SYSTEM",
        label: "No dedicated kitchen system",
        captureMethod: "Manual POS timestamps",
        confidence: "Low",
        ticketTimeMultiplier: 1.35,
        lateTicketMultiplier: 1.65,
        remakeVisibility: "Manual",
        notes: [
          "Kitchen start and ready times require manual entry.",
          "Late ticket metrics are estimated until hardware is configured.",
        ],
      },
    };
    return adjustments[profile.kitchenMode];
  },
};

export const SerametLocalPrintBridge = {
  getStatus(): PrintBridgeStatus {
    return {
      ...serametPrintBridge,
      authenticated: bridgeCounters.authenticated,
      lastHeartbeat: nowStamp(),
      acceptedJobs: bridgeCounters.acceptedJobs,
      rejectedJobs: bridgeCounters.rejectedJobs,
    };
  },

  authenticate(pin: string) {
    bridgeCounters = { ...bridgeCounters, authenticated: pin.trim().length >= 4 };
    return this.getStatus();
  },

  discoverPrinters(profile: BranchHardwareProfile) {
    return profile.printers.map((printer) => ({
      ...printer,
      bridgeVisible: printer.connection !== "Offline",
      driver: printer.roles.includes("KITCHEN") ? "ESC/POS impact" : "ESC/POS thermal",
    }));
  },

  validateJob(job: PrintJob) {
    if (!this.getStatus().online) return { valid: false, message: "Local print bridge is offline" };
    if (!this.getStatus().authenticated)
      return { valid: false, message: "Local print bridge is not authenticated" };
    if (!job.content.trim()) return { valid: false, message: "Print job has no rendered content" };
    if (job.printerId === "UNASSIGNED")
      return { valid: false, message: "Print job has no printer assignment" };
    return { valid: true, message: "Ready" };
  },

  submitJob(job: PrintJob): BridgeSubmitResult {
    const validation = this.validateJob(job);
    if (!validation.valid) {
      bridgeCounters = { ...bridgeCounters, rejectedJobs: bridgeCounters.rejectedJobs + 1 };
      return { accepted: false, message: validation.message };
    }
    bridgeCounters = { ...bridgeCounters, acceptedJobs: bridgeCounters.acceptedJobs + 1 };
    return { accepted: true, bridgeJobId: makeId("BR"), message: "Accepted by local print bridge" };
  },

  createTrustedBridgePayload(job: PrintJob, printerName?: string) {
    return stripUndefined({
      id: job.id,
      branch: job.branch,
      orderId: job.orderId,
      documentType: job.documentType,
      printerId: job.printerId,
      printerName,
      destination: job.destination,
      copies: job.copies,
      template: job.template,
      kitchenTicketId: job.kitchenTicketId,
      kitchenTicketRecordId: job.kitchenTicketRecordId,
      kitchenDelivery: job.kitchenDelivery,
      content: job.content,
    });
  },

  async submitToInstalledBridge(
    job: PrintJob,
    token: string,
    endpoint = "http://127.0.0.1:48777",
  ): Promise<BridgeSubmitResult> {
    const response = await fetch(`${endpoint}/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(this.createTrustedBridgePayload(job)),
    });
    const payload = (await response.json()) as BridgeSubmitResult;
    if (!response.ok)
      return {
        accepted: false,
        message: payload.message ?? "Installed bridge rejected the print job",
      };
    return payload;
  },
};

export function branchHasCapability(branch: string | undefined, capability: BranchCapability) {
  if (!branch || branch === "All Branches") {
    return Object.values(branchHardwareProfiles).some(
      (profile) => profile.capabilities[capability] === true,
    );
  }
  return (
    (branchHardwareProfiles[branch] ?? branchHardwareProfiles.Westlands).capabilities[
      capability
    ] === true
  );
}

function findPrinterByRole(profile: BranchHardwareProfile, role: PrinterRole) {
  if (role === "KDS") return undefined;
  return profile.printers.find((printer) => printer.roles.includes(role));
}

function createJob({
  profile,
  order,
  documentType,
  resolution,
  content,
  productionStation,
  kitchenTicketId,
  kitchenTicketRecordId,
  kitchenDelivery,
  amendmentType,
  duplicateKey,
}: {
  profile: BranchHardwareProfile;
  order: OrderForPrint;
  documentType: PrintDocumentType;
  resolution: RouteResolution;
  content: string;
  productionStation?: ProductionStation;
  kitchenTicketId?: string;
  kitchenTicketRecordId?: string;
  kitchenDelivery?: KitchenTicketDelivery;
  amendmentType?: PrintJob["amendmentType"];
  duplicateKey?: string;
}): PrintJob {
  const assignedPrinter =
    resolution.routeMode === "fallback" ? resolution.fallbackPrinter : resolution.printer;
  const isKdsTicket = resolution.destination === "KDS" || documentType === "KDS_TICKET";
  const base: PrintJob = {
    id: makeId("PJ"),
    branch: profile.branch,
    orderId: order.orderId,
    documentType,
    destination: resolution.destination,
    printerId: isKdsTicket
      ? "KDS-DISPLAY"
      : (assignedPrinter?.id ?? resolution.printer?.id ?? "UNASSIGNED"),
    createdAt: nowStamp(),
    requestedBy: order.requestedBy,
    copies: resolution.route.copies,
    status: "Queued",
    retryCount: 0,
    template: resolution.route.template,
    content,
    duplicateKey:
      duplicateKey ?? `DOCUMENT:${order.branch}:${order.orderId}:${documentType}:${makeId("DUP")}`,
  };
  return stripUndefined({
    ...base,
    fallbackPrinterId:
      resolution.routeMode === "fallback" ? resolution.fallbackPrinter?.id : undefined,
    failureReason: resolution.routeMode === "failed" ? resolution.failureReason : undefined,
    productionStation,
    kitchenTicketId,
    kitchenTicketRecordId,
    kitchenDelivery,
    amendmentType,
  });
}

function productionDocumentType(station: ProductionStation): PrintDocumentType {
  if (station === "BAR") return "BAR_TICKET";
  if (station === "DISPATCH") return "DISPATCH_TICKET";
  return "FOOD_KOT";
}

function productionDeliveriesForMode(mode: KitchenOperatingMode): KitchenTicketDelivery[] {
  if (mode === "KDS_ONLY") return ["KDS_DISPLAY"];
  if (mode === "KDS_AND_PRINTER") return ["KDS_DISPLAY", "PRODUCTION_PRINT"];
  if (mode === "NO_DEDICATED_KITCHEN_SYSTEM") return ["POS_FRONT_PRINT"];
  return ["PRODUCTION_PRINT"];
}

function resolveFrontProductionPrinter(
  profile: BranchHardwareProfile,
  documentType: PrintDocumentType,
): RouteResolution {
  const route = profile.documentRoutes[documentType];
  const front =
    findPrinterByRole(profile, "FRONT") ??
    profile.printers.find((printer) => printer.connection !== "Offline");
  if (front?.connection === "Connected" || front?.connection === "Degraded") {
    return {
      destination: "FRONT",
      printer: front,
      routeMode: "primary",
      route,
    };
  }
  return {
    destination: "FRONT",
    printer: front,
    routeMode: "failed",
    failureReason: front
      ? `${front.name} is ${front.connection.toLowerCase()}`
      : "No POS/front printer is configured",
    route,
  };
}

function groupProductionLines(lines: OrderLineForPrint[]) {
  const groups = new Map<ProductionStation, OrderLineForPrint[]>();
  lines.forEach((line) => {
    const station = line.productionStation;
    if (station === "NONE") return;
    groups.set(station, [...(groups.get(station) ?? []), line]);
  });
  return groups;
}

function renderProductionTicket(
  documentType: PrintDocumentType,
  order: OrderForPrint,
  station: ProductionStation,
  lines: OrderLineForPrint[],
  amendmentType: NonNullable<PrintJob["amendmentType"]>,
  profile: BranchHardwareProfile,
) {
  const width = documentType === "KDS_TICKET" ? 42 : 32;
  const isBar = documentType === "BAR_TICKET";
  const title = documentType === "KDS_TICKET" ? "KDS ORDER" : isBar ? "BAR ORDER" : "KITCHEN ORDER";
  const ticketPrefix = isBar ? "BAR" : "KOT";
  const showPrices = documentTemplates.BILL.showKotPrices === true;
  const identity = profile.printIdentity;
  const issued = documentDateTime(order.createdAt);

  if (amendmentType !== "NEW") {
    return renderAmendmentTicket(amendmentType, order, lines, identity, width);
  }

  return [
    center(identity.receiptBrand, width),
    center(title, width),
    ribbon(`${ticketPrefix} ${cleanOrderId(order.orderId)}`, width),
    dotted(width),
    order.table ? serviceLine(order.orderType, order.table, width) : order.orderType.toUpperCase(),
    `${issued.date} - ${issued.time}`,
    `ORDER ${order.orderId}`,
    `STATION: ${station}`,
    profile.kitchenMode === "NO_DEDICATED_KITCHEN_SYSTEM" ? "ROUTE: POS FRONT PRINTER" : "",
    dotted(width),
    row("QTY", showPrices ? "ITEM / AMOUNT" : "ITEM", width),
    dotted(width),
    ...lines.flatMap((line) => productionLineRows(line, width, showPrices)),
    boxedNote("SPECIAL REQUEST", order.kitchenNote, width),
    `Requested by: ${order.requestedBy}`,
    `Printed: ${timeOnly(nowStamp())}`,
    ribbon("*** NEW ORDER ***", width),
  ]
    .filter(Boolean)
    .join("\n");
}

function renderCustomerDocument(
  documentType: "BILL" | "RECEIPT" | "INVOICE",
  order: OrderForPrint,
  template: PrintTemplateSettings,
  profile: BranchHardwareProfile,
) {
  if (documentType === "INVOICE" || template.width === "A4") {
    return renderA4Invoice(order, template, profile);
  }

  const width = template.width === "58mm" ? 32 : 42;
  const title = documentType === "BILL" ? "BILL" : "RECEIPT";
  const identity = profile.printIdentity;
  const documentNumber =
    documentType === "BILL"
      ? (order.invoiceNumber ?? `INV ${cleanOrderId(order.orderId)}`)
      : (order.receiptNumber ?? `RCP ${cleanOrderId(order.orderId)}`);
  const issued = documentDateTime(order.createdAt);
  const paymentRows = documentType === "RECEIPT" ? renderPaymentRows(order, width) : [];
  const settlementBanner =
    documentType === "BILL"
      ? boxText("PAYMENT PENDING", width)
      : ribbon(row("PAID", formatMoney(order.paid ?? order.total), width), width);
  const qrBlock =
    documentType === "BILL"
      ? ["", boxedPaymentPrompt(order.tillNumber ?? identity.tillNumber, width)]
      : [];
  const footer =
    documentType === "BILL"
      ? template.footerMessage
      : `Thank you for dining with us.\n${identity.footerMessage}`;

  return [
    center(identity.businessName, width),
    template.showBranch ? center(identity.branchName, width) : "",
    center(identity.address, width),
    center(`Tel: ${identity.phone}`, width),
    dotted(width),
    center(title, width),
    boxText(documentNumber, width),
    "",
    row(issued.date, issued.time, width),
    row(`Order: ${order.orderId}`, order.table ? `Table: ${order.table}` : order.orderType, width),
    template.showCashier
      ? `${documentType === "BILL" ? "Served by" : "Cashier"}: ${order.cashier}`
      : "",
    template.showCustomer ? `Bill to: ${order.customer ?? "Walk-in Customer"}` : "",
    dotted(width),
    row("QTY  ITEM", "AMOUNT", width),
    dotted(width),
    ...order.lines.flatMap((line) => customerLineRows(line, width)),
    dotted(width),
    row("SUBTOTAL", formatMoney(order.subtotal), width),
    row("DISCOUNT", formatMoney(0), width),
    template.showTax ? row("TAX", formatMoney(order.tax), width) : "",
    row("TOTAL", formatMoney(order.total), width),
    settlementBanner,
    ...paymentRows,
    ...qrBlock,
    dotted(width),
    footer,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderA4Invoice(
  order: OrderForPrint,
  template: PrintTemplateSettings,
  profile: BranchHardwareProfile,
) {
  const width = 78;
  const identity = profile.printIdentity;
  const invoiceNumber = order.invoiceNumber ?? `INV ${cleanOrderId(order.orderId)}`;
  const issued = documentDateTime(order.createdAt);
  return [
    row(identity.businessName, "TAX INVOICE", width),
    row(identity.branchName, invoiceNumber, width),
    row(identity.address, `Date: ${issued.date}`, width),
    row(`Tel: ${identity.phone}`, `Time: ${issued.time}`, width),
    row(`Email: ${identity.email}`, `Due Date: ${documentDueDate(order.createdAt)}`, width),
    row(`PIN: ${identity.pin}`, "", width),
    rule(width),
    row("BILL TO", "SERVICE INFO", width),
    row(order.customer ?? "Walk-in Customer", `Order: ${order.orderId}`, width),
    row(
      order.customerEmail ?? "",
      order.table ? `Table: ${order.table}` : `Channel: ${order.orderType}`,
      width,
    ),
    row(order.customerPhone ?? "", template.showCashier ? `Cashier: ${order.cashier}` : "", width),
    rule(width),
    row("QTY  DESCRIPTION", "UNIT PRICE      AMOUNT", width),
    rule(width),
    ...order.lines.flatMap((line) => invoiceLineRows(line, width)),
    rule(width),
    row("SUBTOTAL", formatMoney(order.subtotal), width),
    row("DISCOUNT", formatMoney(0), width),
    template.showTax ? row("TAX", formatMoney(order.tax), width) : "",
    row("TOTAL", formatMoney(order.total), width),
    rule(width),
    "PAYMENT INFORMATION",
    `M-PESA TILL: ${order.tillNumber ?? identity.tillNumber}`,
    `BANK: ${identity.bankName}`,
    `A/C NAME: ${identity.bankAccountName}`,
    `A/C NO: ${identity.bankAccountNumber}`,
    "",
    row("THANK YOU", "Authorised Signatory", width),
    template.footerMessage,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderAmendmentTicket(
  amendmentType: NonNullable<PrintJob["amendmentType"]>,
  order: OrderForPrint,
  lines: OrderLineForPrint[],
  identity: BranchPrintIdentity,
  width: number,
) {
  const issued = documentDateTime(order.createdAt);
  const header =
    amendmentType === "VOID"
      ? "*** CANCEL ITEM ***"
      : amendmentType === "REPRINT"
        ? "*** REPRINT ***"
        : "*** ADDITION ***";
  return [
    center(identity.receiptBrand, width),
    ribbon(header, width),
    `ORDER ${order.orderId}`,
    order.table ? `TABLE ${order.table}` : order.orderType.toUpperCase(),
    `${issued.date} - ${issued.time}`,
    dotted(width),
    ...lines.map((line) => `${line.quantity} x ${line.name.toUpperCase()}`.slice(0, width)),
    dotted(width),
    amendmentType === "VOID" ? "Reason: Customer changed order." : "",
    amendmentType === "VOID" ? `Cancelled by: ${order.cashier}` : "",
    amendmentType === "VOID" ? "Approved by: Supervisor" : "",
    amendmentType === "REPRINT"
      ? `Reprinted by: ${order.cashier}`
      : `Requested by: ${order.requestedBy}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function boxedPaymentPrompt(tillNumber: string, width: number) {
  const innerWidth = Math.max(10, width - 4);
  return [
    boxLine(width),
    `| ${"PAY VIA M-PESA".padEnd(Math.floor(innerWidth / 2))}${"SCAN TO PAY".padStart(Math.ceil(innerWidth / 2))} |`,
    `| ${`Till Number: ${tillNumber}`.padEnd(innerWidth)} |`,
    `| ${"QR: use bill QR from provider".padEnd(innerWidth)} |`,
    boxLine(width),
  ].join("\n");
}

function productionLineRows(line: OrderLineForPrint, width: number, showPrices: boolean) {
  const itemLabel = `${line.quantity} x ${line.name.toUpperCase()}`;
  const rows = [
    showPrices
      ? row(itemLabel, formatMoney(line.quantity * line.unitPrice), width)
      : itemLabel.slice(0, width),
  ];
  if (line.itemNote?.trim()) rows.push(...wrap(`  - ${line.itemNote.toUpperCase()}`, width));
  if (line.modifiers?.length)
    rows.push(
      ...line.modifiers.flatMap((modifier) => wrap(`  - ${modifier.toUpperCase()}`, width)),
    );
  return rows;
}

function customerLineRows(line: OrderLineForPrint, width: number) {
  const label = `${line.quantity}  ${line.name}`;
  const rows = [row(label, formatMoney(line.quantity * line.unitPrice), width)];
  if (line.modifiers?.length) rows.push(...wrap(`   ${line.modifiers.join(", ")}`, width));
  if (line.itemNote?.trim()) rows.push(...wrap(`   Note: ${line.itemNote}`, width));
  return rows;
}

function invoiceLineRows(line: OrderLineForPrint, width: number) {
  const descriptionWidth = Math.max(28, width - 32);
  const first = `${line.quantity}    ${line.name}`.slice(0, descriptionWidth);
  const rows = [
    row(
      first,
      `${formatMoney(line.unitPrice).padStart(12)} ${formatMoney(line.quantity * line.unitPrice).padStart(12)}`,
      width,
    ),
  ];
  if (line.modifiers?.length) rows.push(...wrap(`     ${line.modifiers.join(", ")}`, width));
  if (line.itemNote?.trim()) rows.push(...wrap(`     Note: ${line.itemNote}`, width));
  return rows;
}

function renderPaymentRows(order: OrderForPrint, width: number) {
  const breakdown = order.paymentBreakdown?.length
    ? order.paymentBreakdown
    : [
        {
          method: order.paymentMethod ?? "Recorded",
          amount: order.paid ?? order.total,
          reference: order.paymentReference,
        },
      ];

  return breakdown
    .flatMap((payment) => [
      row(payment.method.toUpperCase(), formatMoney(payment.amount), width),
      payment.reference ? `Ref: ${payment.reference}` : "",
    ])
    .filter(Boolean);
}

function boxedNote(label: string, note: string | undefined, width: number) {
  const trimmed = note?.trim();
  if (!trimmed) return "";
  const innerWidth = Math.max(10, width - 4);
  return [
    boxLine(width),
    center(label, width),
    ...wrap(`"${trimmed}"`, innerWidth).map((line) => `| ${line.padEnd(innerWidth)} |`),
    boxLine(width),
  ].join("\n");
}

function serviceLine(orderType: string, table: string, width: number) {
  return `${orderType.toUpperCase()} - TABLE ${table}`.slice(0, width);
}

function boxText(text: string, width: number) {
  const clean = sanitizePrintText(text);
  return `[ ${clean} ]`.slice(0, width);
}

function ribbon(text: string, width: number) {
  const clean = sanitizePrintText(text);
  const padded = ` ${clean} `;
  if (padded.length >= width) return padded.slice(0, width);
  const side = Math.floor((width - padded.length) / 2);
  return `${"=".repeat(side)}${padded}${"=".repeat(width - padded.length - side)}`;
}

function dotted(width: number) {
  return ".".repeat(width);
}

function boxLine(width: number) {
  return `+${"-".repeat(Math.max(2, width - 2))}+`;
}

function row(left: string, right: string, width: number) {
  const cleanLeft = sanitizePrintText(left);
  const cleanRight = sanitizePrintText(right);
  const gap = Math.max(1, width - cleanLeft.length - cleanRight.length);
  if (gap === 1 && cleanLeft.length + cleanRight.length + gap > width) {
    return `${cleanLeft}\n${cleanRight.padStart(width)}`;
  }
  return `${cleanLeft}${" ".repeat(gap)}${cleanRight}`.slice(0, width);
}

function center(text: string, width: number) {
  const clean = sanitizePrintText(text).slice(0, width);
  const left = Math.max(0, Math.floor((width - clean.length) / 2));
  return `${" ".repeat(left)}${clean}`;
}

function rule(width: number) {
  return "-".repeat(width);
}

function wrap(text: string, width: number) {
  const clean = sanitizePrintText(text);
  const words = clean.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  words.forEach((word) => {
    if (!current) {
      current = word;
      return;
    }
    if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
      return;
    }
    lines.push(current);
    current = word;
  });

  if (current) lines.push(current);
  return lines.length ? lines : [clean.slice(0, width)];
}

function sanitizePrintText(text: string) {
  return text
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanOrderId(orderId: string) {
  return orderId.startsWith("#") ? orderId : `#${orderId}`;
}

function formatMoney(amount: number) {
  return ksh(amount).replace("KSh", "KSh");
}

function timeOnly(value: string) {
  const parts = value.split(",");
  return parts[1]?.trim() ?? value;
}

function documentDateTime(value: string) {
  const parsed = new Date(value);
  const date = Number.isNaN(parsed.getTime())
    ? new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const time = Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false });
  return { date, time };
}

function documentDueDate(createdAt: string) {
  return createdAt.includes("Due") ? createdAt : "--";
}

function failJob(job: PrintJob, reason: string) {
  return stripUndefined({
    ...job,
    status: "Failed" as const,
    failureReason: reason,
  });
}

function stripUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
