import { activeLocale, activeCurrency } from "@/lib/currency";
import { parseMajorAmount, formatMinor, minorDigits } from "@/payments/money";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { getSerametAccessToken } from "@/lib/access-token";
import type { Product } from "@/lib/menu-product";
import {
  getConfiguredBranchHardwareProfile,
  getConfiguredBranchHardwareProfiles,
  getConfiguredPrintTemplates,
  saveConfiguredBranchHardwareProfile,
} from "@/platform/adapters/print-profile-adapter";

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
  | "Bridge accepted"
  | "Delivery uncertain"
  | "Fallback Printed"
  | "Cancelled";
export type KitchenTicketDelivery = "KDS_DISPLAY" | "PRODUCTION_PRINT" | "POS_FRONT_PRINT";
export type PrinterConnection = "Connected" | "Offline" | "Degraded" | "Unknown";
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
  currency?: string;
  locale?: string;
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
  paymentInstructions: string[];
  timeZone: string;
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
  enabled?: boolean;
  stationKeys?: string[];
  configuredTransport?: boolean;
  copies?: number;
};

export type BranchHardwareProfile = {
  tenantId: string;
  branchId: string;
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
  templateSettings: Record<"BILL" | "RECEIPT" | "INVOICE", PrintTemplateSettings>;
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
  kitchenObligationId?: string;
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
  serviceCharge?: number;
  discount?: number;
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
  loyaltySummary?: {
    memberCode?: string;
    tier?: string;
    pointsBalance?: number;
    pointsEarned?: number;
    rewardUsed?: string;
    voucherUsed?: string;
    message?: string;
  };
};

export type PrintJob = {
  id: string;
  branchId?: string;
  tenantId?: string;
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
  obligationId?: string;
  claimToken?: string;
  recordId?: string;
  copyIndex?: number;
  reprintReason?: string;
  authorizationReprintId?: string;
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

export type InstalledBridgeHealth = {
  id: string;
  ok: boolean;
  dryRun: boolean;
  platform: string;
  dataDir: string;
  version: string;
};

export type InstalledPrinter = {
  name: string;
  status: string;
  rawStatus?: string | number;
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

const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const nowStamp = (timeZone = localTimeZone) =>
  new Date().toLocaleString(undefined, { timeZone, hour12: false });

const makeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();

const liveRecord = <T>(load: () => Record<string, T>) =>
  new Proxy({} as Record<string, T>, {
    get: (_target, property) => load()[String(property)],
    ownKeys: () => Reflect.ownKeys(load()),
    getOwnPropertyDescriptor: (_target, property) => {
      const record = load();
      if (!(property in record)) return undefined;
      return { configurable: true, enumerable: true, value: record[String(property)] };
    },
  });

export const documentTemplates = liveRecord<PrintTemplateSettings>(
  getConfiguredPrintTemplates,
) as Record<"BILL" | "RECEIPT" | "INVOICE", PrintTemplateSettings>;

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

export const branchHardwareProfiles = liveRecord<BranchHardwareProfile>(
  getConfiguredBranchHardwareProfiles,
);

type RouteResolution = {
  destination: PrinterRole;
  printer?: PrinterDevice;
  fallbackPrinter?: PrinterDevice;
  routeMode: "primary" | "fallback" | "failed";
  failureReason?: string;
  route: BranchHardwareProfile["documentRoutes"][PrintDocumentType];
};

export const SerametPrintService = {
  formatDuplicateCopy(content: string, paperWidth: "58mm" | "80mm" | "A4") {
    const width = paperWidth === "58mm" ? 32 : paperWidth === "80mm" ? 42 : 78;
    return joinThermalSections([thermalBox("DUPLICATE COPY", [], width), content]);
  },
  getBranchHardwareProfile(branch: string, tenantId?: string) {
    return getConfiguredBranchHardwareProfile(branch, tenantId);
  },

  saveBranchHardwareProfile(profile: BranchHardwareProfile) {
    const saved = saveConfiguredBranchHardwareProfile(profile);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("seramet:hardware-profile-change", { detail: { branch: profile.branch } }),
      );
    }
    return saved;
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
    const eligible = profile.printers.filter((printer) => printer.enabled !== false);
    const explicitStation = productionStation
      ? eligible.filter((printer) => printer.stationKeys?.includes(productionStation))
      : [];
    if (explicitStation.length > 1) throw new Error("Ambiguous station printer assignment");
    const configured = eligible.filter((printer) => printer.configuredTransport);
    const exact =
      explicitStation[0] ??
      (!productionStation
        ? configured.find((printer) => printer.roles.includes(route.primaryRole))
        : undefined);
    if (profile.printers.some((printer) => printer.configuredTransport)) {
      if (!exact)
        return {
          destination: route.primaryRole,
          routeMode: "failed",
          route,
          failureReason: "No explicit enabled printer assignment for this document/station",
        };
      const fallbackPrinter = eligible.find((printer) => printer.id === exact.fallbackPrinterId);
      return {
        destination: route.primaryRole,
        printer: exact,
        route: { ...route, copies: exact.copies ?? route.copies },
        ...(fallbackPrinter ? { fallbackPrinter } : {}),
        routeMode: "primary",
      };
    }
    const onePrinter =
      profile.printers.filter((printer) => printer.connection !== "Offline").length === 1;
    const destination = productionStation
      ? (profile.stationRoutes[productionStation] ?? route.primaryRole)
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
      return {
        destination,
        printer: primary,
        ...(fallbackPrinter ? { fallbackPrinter } : {}),
        routeMode: "primary",
        route,
      };
    }
    if (fallbackPrinter && fallbackPrinter.connection !== "Offline") {
      return {
        destination,
        ...(primary ? { printer: primary } : {}),
        fallbackPrinter,
        routeMode: "fallback",
        route,
      };
    }
    if (primary) {
      return {
        destination,
        printer: primary,
        ...(fallbackPrinter ? { fallbackPrinter } : {}),
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
    const job = createJob({
      profile,
      order,
      documentType,
      resolution,
      content: renderCustomerDocument(
        documentType,
        order,
        profile.templateSettings[documentType],
        profile,
      ),
    });
    return {
      ...job,
      recordId: documentType === "RECEIPT" ? order.receiptNumber : order.invoiceNumber,
    };
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
        order.kitchenObligationId ??
        (amendmentType === "NEW"
          ? ticketId
          : `${ticketId}-${amendmentType}-${Date.now().toString(36)}`);
      const stationRole = profile.stationRoutes[station];
      const printDocumentType =
        stationRole === "BAR"
          ? "BAR_TICKET"
          : stationRole === "DISPATCH"
            ? "DISPATCH_TICKET"
            : productionDocumentType(station);
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
              kitchenTicketId,
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
    const reprint: PrintJob = {
      ...original,
      id: makeId("RP"),
      createdAt: nowStamp(),
      requestedBy,
      printerId: assignedPrinter?.id ?? resolution.printer?.id ?? original.printerId,
      status: "Queued" as const,
      retryCount: 0,
      content: [
        thermalBox(
          "DUPLICATE COPY",
          [`Reason: ${reason}`],
          productionTicketWidth(profile, original.documentType),
        ),
        original.content,
      ].join("\n"),
      duplicateKey,
      reprintOfJobId: original.id,
      ...(resolution.routeMode === "fallback" && resolution.fallbackPrinter?.id
        ? { fallbackPrinterId: resolution.fallbackPrinter.id }
        : {}),
      ...(resolution.routeMode === "failed" && resolution.failureReason
        ? { failureReason: resolution.failureReason }
        : {}),
      ...(original.kitchenTicketId
        ? { kitchenTicketId: `${original.kitchenTicketId}-REPRINT-${Date.now().toString(36)}` }
        : {}),
      ...(original.amendmentType ? { amendmentType: "REPRINT" as const } : {}),
    };
    delete reprint.printedAt;
    if (resolution.routeMode !== "fallback") delete reprint.fallbackPrinterId;
    if (resolution.routeMode !== "failed") delete reprint.failureReason;

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
    const next: PrintJob[] = jobs.map((job) => {
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
      return stripUndefined(retried) as PrintJob;
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
        const fallbackJob: PrintJob = {
          ...job,
          fallbackPrinterId: fallback.id,
          status: "Fallback Printed" as const,
          printedAt: nowStamp(),
          retryCount: job.retryCount + 1,
        };
        delete fallbackJob.failureReason;
        return fallbackJob;
      })
      .map((job) => stripUndefined(job) as PrintJob);
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

  async getInstalledBridgeHealth(
    endpoint = "http://127.0.0.1:48777",
  ): Promise<InstalledBridgeHealth> {
    const response = await fetch(`${endpoint}/health`);
    if (!response.ok) throw new Error(`Print bridge health check failed: ${response.status}`);
    return (await response.json()) as InstalledBridgeHealth;
  },

  async discoverInstalledPrinters(
    token: string,
    endpoint = "http://127.0.0.1:48777",
  ): Promise<InstalledPrinter[]> {
    const response = await fetch(`${endpoint}/printers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = (await response.json()) as { printers?: InstalledPrinter[]; message?: string };
    if (!response.ok) throw new Error(payload.message ?? "Print bridge printer discovery failed");
    return payload.printers ?? [];
  },

  async submitToInstalledBridge(
    job: PrintJob,
    token: string,
    endpoint = "http://127.0.0.1:48777",
    printerName?: string,
  ): Promise<BridgeSubmitResult> {
    const targetUrl = new URL(endpoint);
    if (
      targetUrl.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(targetUrl.hostname) ||
      targetUrl.username ||
      targetUrl.password
    ) {
      throw new Error("Only an enrolled loopback print bridge is supported");
    }
    const accessToken = getSerametAccessToken();
    const authorized = await authenticatedFetch("/api/seramet/printing/authorize", {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        "Content-Type": "application/json",
        ...(job.branchId ? { "x-seramet-branch-id": job.branchId } : {}),
        ...(job.tenantId ? { "x-seramet-tenant-id": job.tenantId } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        printerId: job.printerId,
        documentType: job.orderId === "#PRINT-TEST" ? "TEST" : job.documentType,
        recordId: job.obligationId ?? job.recordId ?? job.orderId,
        ...(job.orderId === "#PRINT-TEST"
          ? {
              testKind:
                job.documentType === "FOOD_KOT" || job.documentType === "BAR_TICKET"
                  ? "FOOD_KOT"
                  : job.documentType,
              recordId: job.id,
            }
          : {}),
        ...(job.claimToken ? { claimToken: job.claimToken } : {}),
        ...(job.reprintReason
          ? { reprintReason: job.reprintReason, reprintId: job.authorizationReprintId }
          : {}),
        copyIndex: job.copyIndex ?? 0,
      }),
    });
    if (!authorized.ok)
      throw new Error(
        "Server print authorization failed; inspect printer configuration and the authoritative document/claim",
      );
    const submission = await authorized.json();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const response = await fetch(`${endpoint}/jobs`, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(submission),
      });
      if (!response.ok)
        return {
          accepted: false,
          message: "Bridge rejected the authorized job; do not blindly retry",
        };
      const payload = (await response.json()) as {
        stage: string;
        bridgeJobId: string;
        message: string;
      };
      if (["BYTES_SUBMITTED", "SPOOL_ACCEPTED"].includes(payload.stage))
        return {
          accepted: true,
          bridgeJobId: payload.bridgeJobId,
          message: "Transport submitted; physical delivery unconfirmed",
        };
      if (["NOT_SENT", "UNCERTAIN", "CANCELLED"].includes(payload.stage))
        return {
          accepted: false,
          message: `Delivery ${payload.stage.toLowerCase()}; use authorized recovery`,
        };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return {
      accepted: false,
      message: "Bridge outcome uncertain; inspect recovery before retrying",
    };
  },
};

export function branchHasCapability(
  branch: string | undefined,
  capability: BranchCapability,
  tenantId?: string,
) {
  try {
    if (!branch || /^all(?:\s+branches)?$/i.test(branch.trim())) {
      return Object.values(getConfiguredBranchHardwareProfiles()).some(
        (profile) =>
          (!tenantId || profile.tenantId === tenantId) && profile.capabilities[capability] === true,
      );
    }
    return (
      SerametPrintService.getBranchHardwareProfile(branch, tenantId).capabilities[capability] ===
      true
    );
  } catch {
    return false;
  }
}

function findPrinterByRole(profile: BranchHardwareProfile, role: PrinterRole) {
  if (role === "KDS") return undefined;
  return profile.printers.find(
    (printer) => printer.enabled !== false && printer.roles.includes(role),
  );
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
    branchId: profile.branchId,
    tenantId: profile.tenantId,
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
  }) as PrintJob;
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
    ...(front ? { printer: front } : {}),
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
  kitchenTicketId?: string,
) {
  const width = productionTicketWidth(profile, documentType);
  const isBar = documentType === "BAR_TICKET";
  const title = documentType === "KDS_TICKET" ? "KDS ORDER" : isBar ? "BAR ORDER" : "KITCHEN ORDER";
  const ticketPrefix = isBar ? "BAR" : "KOT";
  const showPrices = profile.templateSettings.BILL.showKotPrices === true;
  const identity = profile.printIdentity;
  const money = (amount: number) => formatMoney(amount, identity.currency, identity.locale);
  const issued = documentDateTime(order.createdAt, identity.timeZone);
  const ticketNumber = printableTicketNumber(kitchenTicketId, order.orderId);

  if (amendmentType !== "NEW") {
    return renderAmendmentTicket(
      amendmentType,
      order,
      lines,
      identity,
      width,
      ticketNumber,
      station,
      title,
    );
  }

  return joinThermalSections([
    ...thermalHeader(identity, width, true, false, false),
    thermalBox(
      title,
      [
        `${ticketPrefix} ${ticketNumber}`,
        `ORDER ${cleanOrderId(order.orderId)}`,
        `STATION: ${station}`,
      ],
      width,
    ),
    thermalBox(
      "ORDER DETAILS",
      [
        `Date: ${issued.date} ${issued.time}`,
        `Mode: ${order.orderType}${order.table ? ` / Table: ${order.table}` : ""}`,
        `Server: ${order.waiter || order.requestedBy}`,
        `Requested by: ${order.requestedBy}`,
        ...(profile.kitchenMode === "NO_DEDICATED_KITCHEN_SYSTEM"
          ? ["Route: POS front printer"]
          : []),
      ],
      width,
    ),
    thermalItems(lines, width, showPrices, money, true),
    boxedNote("SPECIAL REQUEST", order.kitchenNote, width),
    ...centeredLines("NEW ORDER", width),
  ]);
}

function renderCustomerDocument(
  documentType: "BILL" | "RECEIPT" | "INVOICE",
  order: OrderForPrint,
  template: PrintTemplateSettings,
  profile: BranchHardwareProfile,
) {
  if (template.width === "A4") {
    return renderA4Invoice(order, template, profile);
  }

  const width = template.width === "58mm" ? 32 : 42;
  const title = documentType === "INVOICE" ? "TAX INVOICE" : documentType;
  const identity = profile.printIdentity;
  const money = (amount: number) => formatMoney(amount, identity.currency, identity.locale);
  const documentNumber =
    documentType !== "RECEIPT"
      ? (order.invoiceNumber ?? `INV ${cleanOrderId(order.orderId)}`)
      : (order.receiptNumber ?? `RCP ${cleanOrderId(order.orderId)}`);
  const issued = documentDateTime(order.createdAt, identity.timeZone);
  const paymentRows =
    documentType === "RECEIPT" || (documentType === "INVOICE" && (order.paid ?? 0) > 0)
      ? renderPaymentRows(order, width, money)
      : [];
  const loyaltyRows = documentType === "RECEIPT" ? renderLoyaltyRows(order, width) : [];
  const settlementBanner =
    documentType === "BILL" || (documentType === "INVOICE" && (order.paid ?? 0) < order.total)
      ? thermalBox("PAYMENT PENDING", [], width)
      : thermalBox(
          "PAID",
          [
            `Paid: ${money(order.paid ?? order.total)}`,
            ...(order.change ? [`Change: ${money(order.change)}`] : []),
          ],
          width,
        );
  const qrBlock =
    documentType !== "RECEIPT" ? [boxedPaymentPrompt(identity.paymentInstructions, width)] : [];
  const footer =
    documentType !== "RECEIPT"
      ? template.footerMessage
      : `Thank you for dining with us.\n${identity.footerMessage}`;

  return joinThermalSections([
    ...thermalHeader(identity, width, template.showBranch, true),
    thermalBox(title, [documentNumber], width),
    thermalBox(
      "ORDER DETAILS",
      [
        `Order: ${order.orderId}`,
        `Date: ${issued.date} ${issued.time}`,
        `Mode: ${order.orderType}${order.table ? ` / Table: ${order.table}` : ""}`,
        ...(template.showCashier
          ? [`${documentType === "BILL" ? "Served by" : "Cashier"}: ${order.cashier}`]
          : []),
        ...(template.showCustomer
          ? [
              `Bill to: ${order.customer ?? "Walk-in Customer"}`,
              ...(order.customerPhone ? [`Phone: ${order.customerPhone}`] : []),
              ...(order.customerEmail ? [order.customerEmail] : []),
            ]
          : []),
      ],
      width,
    ),
    thermalItems(order.lines, width, true, money, false, documentType === "INVOICE"),
    thermalTotals(order, template, width, money),
    settlementBanner,
    ...paymentRows,
    ...loyaltyRows,
    ...qrBlock,
    rule(width),
    ...footer.split("\n").flatMap((line) => centeredLines(line, width)),
  ]);
}

function renderA4Invoice(
  order: OrderForPrint,
  template: PrintTemplateSettings,
  profile: BranchHardwareProfile,
) {
  const width = 78;
  const identity = profile.printIdentity;
  const money = (amount: number) => formatMoney(amount, identity.currency, identity.locale);
  const invoiceNumber = order.invoiceNumber ?? `INV ${cleanOrderId(order.orderId)}`;
  const issued = documentDateTime(order.createdAt, identity.timeZone);
  return joinThermalSections([
    ...thermalHeader(identity, width, true, true),
    thermalBox("TAX INVOICE", [invoiceNumber], width),
    thermalBox(
      "BILL TO / SERVICE INFO",
      [
        order.customer ?? "Walk-in Customer",
        order.customerEmail ?? "",
        order.customerPhone ?? "",
        `Order: ${order.orderId}`,
        `Date: ${issued.date} ${issued.time}`,
        `Mode: ${order.orderType}${order.table ? ` / Table: ${order.table}` : ""}`,
        ...(template.showCashier ? [`Cashier: ${order.cashier}`] : []),
      ],
      width,
    ),
    thermalItems(order.lines, width, true, money, false, true),
    thermalTotals(order, template, width, money),
    thermalBox("PAYMENT INFORMATION", identity.paymentInstructions, width),
    ...centeredLines("THANK YOU", width),
    ...centeredLines("Authorised Signatory", width),
    ...centeredLines(template.footerMessage, width),
  ]);
}

function renderAmendmentTicket(
  amendmentType: NonNullable<PrintJob["amendmentType"]>,
  order: OrderForPrint,
  lines: OrderLineForPrint[],
  identity: BranchPrintIdentity,
  width: number,
  ticketNumber?: string,
  station?: ProductionStation,
  title = "KITCHEN ORDER",
) {
  const issued = documentDateTime(order.createdAt, identity.timeZone);
  const header =
    amendmentType === "VOID"
      ? "*** CANCEL ITEM ***"
      : amendmentType === "REPRINT"
        ? "*** REPRINT ***"
        : "*** ADDITION ***";
  return joinThermalSections([
    ...thermalHeader(identity, width, true, false, false),
    thermalBox(
      title,
      [
        header,
        ...(ticketNumber ? [`${title === "BAR ORDER" ? "BAR" : "KOT"} ${ticketNumber}`] : []),
        `ORDER ${cleanOrderId(order.orderId)}`,
        ...(station ? [`STATION: ${station}`] : []),
      ],
      width,
    ),
    thermalBox(
      "ORDER DETAILS",
      [
        `Date: ${issued.date} ${issued.time}`,
        `Mode: ${order.orderType}${order.table ? ` / Table: ${order.table}` : ""}`,
        `Requested by: ${order.requestedBy}`,
      ],
      width,
    ),
    thermalItems(lines, width, false, formatMoney, true),
    boxedNote("SPECIAL REQUEST", order.kitchenNote, width),
    thermalBox(
      "OPERATOR",
      [
        ...(amendmentType === "VOID"
          ? [
              "Reason: Customer changed order.",
              `Cancelled by: ${order.cashier}`,
              "Approved by: Supervisor",
            ]
          : []),
        amendmentType === "REPRINT"
          ? `Reprinted by: ${order.cashier}`
          : `Requested by: ${order.requestedBy}`,
      ],
      width,
    ),
  ]);
}

function boxedPaymentPrompt(paymentInstructions: string[], width: number) {
  const innerWidth = Math.max(10, width - 4);
  const instructions = paymentInstructions.length
    ? paymentInstructions
    : ["Payment instructions not configured"];
  return [
    boxLine(width),
    `| ${"PAYMENT OPTIONS".padEnd(innerWidth)} |`,
    ...instructions.flatMap((instruction) =>
      wrap(instruction, innerWidth).map((line) => `| ${line.padEnd(innerWidth)} |`),
    ),
    boxLine(width),
  ].join("\n");
}

function productionTicketWidth(profile: BranchHardwareProfile, documentType: PrintDocumentType) {
  if (documentType === "KDS_TICKET") return 42;
  const template = profile.documentRoutes[documentType]?.template ?? "";
  return template.includes("58mm") || template.includes("single-printer") ? 32 : 42;
}

function printableTicketNumber(kitchenTicketId: string | undefined, orderId: string) {
  if (orderId.startsWith("#")) return orderId;
  const source = kitchenTicketId ?? orderId;
  const digits = source.replace(/\D/g, "");
  if (digits) return `#${digits.slice(-5).padStart(5, "0")}`;
  return cleanOrderId(orderId);
}

function centeredLines(text: string, width: number) {
  if (!text.trim()) return [];
  return wrap(text, width).map((line) => " ".repeat(Math.floor((width - line.length) / 2)) + line);
}

function thermalHeader(
  identity: BranchPrintIdentity,
  width: number,
  branch: boolean,
  pin: boolean,
  contact = true,
) {
  const lines = [
    identity.receiptBrand,
    identity.businessName !== identity.receiptBrand ? identity.businessName : "",
    branch ? identity.branchName : "",
    contact ? identity.address : "",
    contact && identity.phone ? `Tel: ${identity.phone}` : "",
    contact ? identity.email : "",
    pin && identity.pin ? `PIN: ${identity.pin}` : "",
  ];
  return lines.flatMap((line) => centeredLines(line, width));
}

function thermalBox(title: string, lines: string[], width: number) {
  const cell = (line: string) => `| ${line.padEnd(width - 4)} |`;
  const centered = [
    "BILL",
    "RECEIPT",
    "INVOICE",
    "TAX INVOICE",
    "KITCHEN ORDER",
    "BAR ORDER",
    "KDS ORDER",
    "DUPLICATE COPY",
    "PAID",
  ].includes(title);
  return [
    boxLine(width),
    ...(centered ? centeredLines(title, width - 4) : wrap(title, width - 4)).map(cell),
    ...(lines.some(Boolean) ? [boxLine(width)] : []),
    ...lines.filter(Boolean).flatMap((line) => wrap(line, width - 4).map(cell)),
    boxLine(width),
  ].join("\n");
}

function tableRule(columns: number[]) {
  return `+${columns.map((width) => "-".repeat(width)).join("+")}+`;
}

function joinThermalSections(sections: string[]) {
  const lines: string[] = [];
  for (const line of sections.filter(Boolean).join("\n").split("\n")) {
    if (/^\+[+\-=]+\+$/.test(line) && lines.at(-1) === line) continue;
    lines.push(line);
  }
  return lines.join("\n");
}

function tableCells(cells: string[], columns: number[], right: number[] = []) {
  const wrapped = cells.map((cell, index) => wrap(cell, columns[index]));
  return Array.from(
    { length: Math.max(...wrapped.map((lines) => lines.length)) },
    (_, line) =>
      `|${columns
        .map((width, index) => {
          const value = wrapped[index][line] ?? "";
          return right.includes(index) ? value.padStart(width) : value.padEnd(width);
        })
        .join("|")}|`,
  );
}

function thermalItems(
  lines: OrderLineForPrint[],
  width: number,
  prices: boolean,
  money: (amount: number) => string,
  production = false,
  unitPrices = false,
) {
  const amountWidth = width === 32 ? 10 : 12;
  const columns = prices ? [3, width - amountWidth - 7, amountWidth] : [3, width - 6];
  const border = tableRule(columns);
  const rows = [
    border,
    ...tableCells(
      prices
        ? ["QTY", width === 32 ? "ITEM" : "DESCRIPTION", width === 32 ? "PRICE" : "AMOUNT"]
        : ["QTY", "ITEM"],
      columns,
    ),
    border,
  ];
  for (const line of lines) {
    const amount = prices ? money(line.quantity * line.unitPrice) : "";
    const name = production ? line.name.toUpperCase() : line.name;
    rows.push(
      ...tableCells(
        prices
          ? [String(line.quantity), name, amount.length <= amountWidth ? amount : ""]
          : [String(line.quantity), name],
        columns,
        prices ? [0, 2] : [0],
      ),
    );
    if (prices && amount.length > amountWidth)
      rows.push(
        ...wrap(`Amount: ${amount}`, width - 4).map((text) => `| ${text.padEnd(width - 4)} |`),
      );
    const details = [
      ...(unitPrices ? [`Unit: ${money(line.unitPrice)}`] : []),
      ...(line.modifiers ?? []).map((item) => `- ${production ? item.toUpperCase() : item}`),
      ...(line.itemNote
        ? [`Note: ${production ? line.itemNote.toUpperCase() : line.itemNote}`]
        : []),
    ];
    // Details span the table interior, preserving indentation without squeezing
    // instructions into the narrow description column.
    for (const detail of details)
      rows.push(...wrap(detail, width - 6).map((text) => `|   ${text.padEnd(width - 6)} |`));
    rows.push(border);
  }
  return rows.join("\n");
}

function thermalTotals(
  order: OrderForPrint,
  template: PrintTemplateSettings,
  width: number,
  money: (amount: number) => string,
) {
  const columns = [width - 17, 14];
  const values: Array<[string, number]> = [
    ["SUBTOTAL", order.subtotal],
    ...(template.showTax ? [["TAX", order.tax] as [string, number]] : []),
    ...(order.serviceCharge !== undefined
      ? [["SERVICE", order.serviceCharge] as [string, number]]
      : []),
    ...(order.discount !== undefined ? [["DISCOUNT", order.discount] as [string, number]] : []),
  ];
  return [
    tableRule(columns),
    ...values.flatMap(([label, amount]) => tableCells([label, money(amount)], columns, [1])),
    tableRule(columns),
    ...tableCells(["TOTAL", money(order.total)], columns, [1]),
    tableRule(columns).replace(/-/g, "="),
  ].join("\n");
}

function renderPaymentRows(
  order: OrderForPrint,
  width: number,
  money: (amount: number) => string = formatMoney,
) {
  const breakdown = order.paymentBreakdown?.length
    ? order.paymentBreakdown
    : [
        {
          method: order.paymentMethod ?? "Recorded",
          amount: order.paid ?? order.total,
          reference: order.paymentReference,
        },
      ];

  return [
    thermalBox(
      "PAYMENT",
      breakdown.flatMap((payment) => [
        `${payment.method.toUpperCase()} ${money(payment.amount)}`,
        ...(payment.reference ? [`Ref: ${payment.reference}`] : []),
      ]),
      width,
    ),
  ];
}

function renderLoyaltyRows(order: OrderForPrint, width: number) {
  const summary = order.loyaltySummary;
  if (!summary) return [];
  return [
    dotted(width),
    summary.memberCode ? row("MEMBER", summary.memberCode, width) : "",
    summary.tier ? row("TIER", summary.tier, width) : "",
    summary.pointsEarned !== undefined
      ? row("POINTS EARNED", summary.pointsEarned.toLocaleString(), width)
      : "",
    summary.pointsBalance !== undefined
      ? row("POINTS BALANCE", summary.pointsBalance.toLocaleString(), width)
      : "",
    summary.rewardUsed ? `Reward: ${summary.rewardUsed}` : "",
    summary.voucherUsed ? `Voucher: ${summary.voucherUsed}` : "",
    ...(summary.message ? wrap(summary.message, width) : []),
  ]
    .filter((line): line is string => Boolean(line))
    .flatMap((line) => line.split("\n").flatMap((part) => wrap(part, width)));
}

function boxedNote(label: string, note: string | undefined, width: number) {
  const trimmed = note?.trim();
  if (!trimmed) return "";
  return thermalBox(label, [trimmed], width);
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

function rule(width: number) {
  return "-".repeat(width);
}

function wrap(text: string, width: number) {
  const clean = sanitizePrintText(text);
  const words = clean
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => {
      const chunks = [];
      for (let start = 0; start < word.length; start += width)
        chunks.push(word.slice(start, start + width));
      return chunks;
    });
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

function formatMoney(amount: number, currency = activeCurrency(), locale = activeLocale()) {
  if (!Number.isFinite(amount)) throw new Error("Invalid authoritative print amount");
  const minor = parseMajorAmount(amount.toFixed(minorDigits(currency)), currency);
  return formatMinor(minor, currency, locale).replace(/\u00a0/g, " ");
}

function timeOnly(value: string) {
  const parts = value.split(",");
  return parts[1]?.trim() ?? value;
}

function documentDateTime(value: string, timeZone = localTimeZone) {
  const parsed = new Date(value);
  const dateOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone,
  } as const;
  const timeOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  } as const;
  const date = Number.isNaN(parsed.getTime())
    ? new Date().toLocaleDateString(activeLocale(), dateOptions)
    : parsed.toLocaleDateString(activeLocale(), dateOptions);
  const time = Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleTimeString(activeLocale(), timeOptions);
  return { date, time };
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
