import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  SerametLocalPrintBridge,
  SerametPrintService,
  type BranchHardwareProfile,
  type OrderForPrint,
  type PrintJob,
  type PrintPlanResult,
  type ReprintLogEntry,
} from "@/lib/seramet-print-service";
import {
  bridgeConfigReady,
  loadInstalledPrintBridgeConfig,
  type InstalledPrintBridgeConfig,
} from "@/lib/print-bridge-client-config";
import { formatDateTime } from "@/lib/currency";
import { DevicePrintQueueStore } from "@/lib/device-print-queue-store";
import { getSerametAccessToken } from "@/lib/access-token";
import type { KitchenPrintObligation } from "@/server/kitchen-print-outbox";

type QueueResult = PrintPlanResult & { queue: PrintJob[] };
type ReprintQueueResult = { queue: PrintJob[]; log: ReprintLogEntry; skipped?: string };

type ClaimedTicket = {
  token: string;
  jobIds: string[];
  submitted: boolean;
};

function kitchenHeaders() {
  const token = getSerametAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function kitchenApi(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: kitchenHeaders(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`Kitchen print service rejected request (HTTP ${response.status})`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

export function useSerametPrintQueue(
  branch: string,
  options: { durableRecovery?: boolean } = {},
) {
  const profileState = useMemo<{
    profile: BranchHardwareProfile | null;
    configurationError: string | null;
  }>(() => {
    try {
      return {
        profile: SerametPrintService.getBranchHardwareProfile(branch),
        configurationError: null,
      };
    } catch (error) {
      return {
        profile: null,
        configurationError:
          error instanceof Error ? error.message : "Printing is not configured for this branch",
      };
    }
  }, [branch]);
  const { profile, configurationError } = profileState;
  const subscribeToQueue = useCallback(
    (listener: () => void) => DevicePrintQueueStore.subscribe(branch, listener),
    [branch],
  );
  const readQueue = useCallback(() => DevicePrintQueueStore.snapshot(branch), [branch]);
  const queue = useSyncExternalStore(subscribeToQueue, readQueue, readQueue);
  const jobs = queue.jobs;
  const reprints = queue.reprints;
  const [durableTicketWarning, setDurableTicketWarning] = useState("");
  const claimedTickets = useRef(new Map<string, ClaimedTicket>());
  const recoveryRunning = useRef(false);
  const setJobs = useCallback<Dispatch<SetStateAction<PrintJob[]>>>(
    (update) => DevicePrintQueueStore.setJobs(branch, update),
    [branch],
  );
  const setReprints = useCallback<Dispatch<SetStateAction<ReprintLogEntry[]>>>(
    (update) => DevicePrintQueueStore.setReprints(branch, update),
    [branch],
  );
  const [bridgeConfig, setBridgeConfig] = useState<InstalledPrintBridgeConfig>(() =>
    loadInstalledPrintBridgeConfig(),
  );

  useEffect(() => {
    const onConfig = () => setBridgeConfig(loadInstalledPrintBridgeConfig());
    window.addEventListener("seramet:print-bridge-config-change", onConfig);
    return () => window.removeEventListener("seramet:print-bridge-config-change", onConfig);
  }, []);

  const processJobs = (
    nextJobs: PrintJob[],
    _existingJobs: PrintJob[],
    targetProfile: BranchHardwareProfile,
  ) => {
    if (!bridgeConfigReady(bridgeConfig)) {
      const processedNext = nextJobs.map((job) =>
        job.printerId === "KDS-DISPLAY"
          ? {
              ...job,
              status: "Displayed" as const,
              printedAt: formatDateTime(new Date(), { hour12: false }),
            }
          : {
              ...job,
              status: "Failed" as const,
              failureReason: "Installed print bridge is not configured on this POS device",
            },
      );
      let processed: PrintJob[] = [];
      setJobs((current) => {
        processed = [...processedNext, ...current];
        return processed;
      });
      return processed;
    }

    let queued: PrintJob[] = [];
    // Functional update: multiple station obligations may be claimed in the same
    // recovery batch. A stale render snapshot must not drop the first station.
    setJobs((current) => {
      queued = [...nextJobs, ...current];
      return queued;
    });
    nextJobs.forEach((job) => {
      void sendInstalledBridgeJob(job, targetProfile, bridgeConfig, setJobs);
    });
    return queued;
  };

  const enqueue = (nextJobs: PrintJob[]): QueueResult => {
    if (!profile) return unavailableResult(jobs, configurationError);
    const queued = processJobs(nextJobs, jobs, profile);
    return { jobs: nextJobs, skipped: [], queue: queued };
  };

  const sendKitchenTickets = (
    order: OrderForPrint,
    amendmentType: "NEW" | "ADDITION" | "VOID" | "REPRINT" = "NEW",
  ): QueueResult => {
    if (!profile) return unavailableResult(jobs, configurationError);
    const plan = SerametPrintService.createProductionTicketJobs(
      profile,
      order,
      jobs,
      amendmentType,
    );
    const queued = processJobs(plan.jobs, jobs, profile);
    return { ...plan, queue: queued };
  };

  /**
   * A server claim is always obtained before any bridge submission. A second
   * terminal receives HTTP 409 and MUST NOT issue a second physical KOT.
   * The server retains every obligation across browser restarts.
   */
  const deliverDurableKitchenPrints = async (orderId?: string) => {
    if (recoveryRunning.current || !profile || !navigator.onLine) return 0;
    recoveryRunning.current = true;
    let started = 0;
    try {
      const base = "/api/seramet/kitchen/print-obligations";
      const listing = await kitchenApi(`${base}?branchId=${encodeURIComponent(branch)}`);
      const obligations = (listing["obligations"] ?? []) as KitchenPrintObligation[];
      const unresolved = obligations.filter((item) =>
        ["UNCERTAIN", "FAILED", "NEEDS_ROUTING"].includes(item.status),
      );
      setDurableTicketWarning(
        unresolved.length
          ? `${unresolved.length} kitchen ticket(s) require printer-manager review. Do not auto-reprint.`
          : "",
      );
      for (const obligation of obligations.slice(0, 50)) {
        if (obligation.status !== "QUEUED" || (orderId && obligation.orderId !== orderId)) {
          continue;
        }
        const preview = SerametPrintService.createProductionTicketJobs(
          profile,
          obligation.snapshot,
          [],
          obligation.amendmentType,
        );
        if (
          !preview.jobs.length ||
          preview.skipped.length ||
          preview.jobs.some(
            (job) =>
              job.printerId === "UNASSIGNED" ||
              (job.printerId !== "KDS-DISPLAY" && !bridgeConfigReady(bridgeConfig)),
          )
        ) {
          setDurableTicketWarning(
            `KOT for ${obligation.orderId} is safely queued on the server, but this device needs printer/KDS configuration.`,
          );
          continue;
        }
        // A recovered local job from a prior claim must be reviewed rather than
        // silently generating a second original KOT.
        if (jobs.some((job) => job.serverObligationId === obligation.id)) {
          setDurableTicketWarning(
            `KOT ${obligation.id} has prior local delivery work. Review delivery status.`,
          );
          continue;
        }
        let claimed: Record<string, unknown>;
        try {
          claimed = await kitchenApi(`${base}/${obligation.id}/claim`, { branchId: branch });
        } catch {
          // Another device may have claimed it; never print without our own claim.
          continue;
        }
        const token = claimed["claimToken"];
        if (typeof token !== "string") {
          throw new Error("Kitchen print server returned no valid claim token");
        }
        const printJobs = preview.jobs.map((job) => ({
          ...job,
          serverObligationId: obligation.id,
        }));
        claimedTickets.current.set(obligation.id, {
          token,
          jobIds: printJobs.map((job) => job.id),
          submitted: false,
        });
        // Device queue state is updated before the bridge receives any ticket.
        processJobs(printJobs, jobs, profile);
        started += 1;
      }
    } catch (error) {
      setDurableTicketWarning(
        error instanceof Error ? error.message : "Kitchen ticket recovery unavailable",
      );
    } finally {
      recoveryRunning.current = false;
    }
    return started;
  };

  // The source of truth is the server obligation, never the React hook lifetime.
  // A crash after claiming may have physically printed: mark it UNCERTAIN and
  // require audited human review instead of automatically resending.
  useEffect(() => {
    for (const [id, claimed] of claimedTickets.current) {
      if (claimed.submitted) continue;
      const matching = jobs.filter((job) => claimed.jobIds.includes(job.id));
      if (matching.length !== claimed.jobIds.length) continue;
      const delivered = matching.every((job) =>
        ["Printed", "Displayed", "Fallback Printed"].includes(job.status),
      );
      const uncertain = matching.some((job) =>
        ["Failed", "Cancelled"].includes(job.status),
      );
      if (!delivered && !uncertain) continue;
      claimed.submitted = true;
      const kdsOnly = matching.every((job) => job.status === "Displayed");
      void kitchenApi(`/api/seramet/kitchen/print-obligations/${id}/ack`, {
        branchId: branch,
        claimToken: claimed.token,
        status: delivered ? "DELIVERED" : "UNCERTAIN",
        evidence: delivered
          ? kdsOnly
            ? "KDS_RENDER_ACK"
            : "PRINT_BRIDGE_ACK"
          : "AMBIGUOUS_TRANSPORT",
        ...(!delivered ? { reason: "Delivery result is uncertain; verify before reprinting" } : {}),
      })
        .then(() => {
          claimedTickets.current.delete(id);
        })
        .catch(() => {
          // Keep the local claim for another acknowledgement attempt;
          // never start another physical print to solve an ACK timeout.
          claimed.submitted = false;
          setDurableTicketWarning("Kitchen ticket acknowledgement is pending; do not reprint.");
        });
    }
  }, [jobs, branch]);

  // POS and printer screens can recover any unclaimed ticket after a crash.
  // Expired claims are never reprinted automatically by this polling loop.
  const durableRecovery = options.durableRecovery === true;
  const recoveryCallback = useRef(deliverDurableKitchenPrints);
  recoveryCallback.current = deliverDurableKitchenPrints;
  useEffect(() => {
    if (!durableRecovery) return;
    void recoveryCallback.current();
    const interval = window.setInterval(() => {
      if (navigator.onLine && document.visibilityState === "visible") {
        void recoveryCallback.current();
      }
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [branch, durableRecovery]);

  const printCustomerDocument = (
    order: OrderForPrint,
    documentType: "BILL" | "RECEIPT" | "INVOICE",
  ): QueueResult => {
    if (!profile) return unavailableResult(jobs, configurationError);
    try {
      const targetProfile =
        order.branch === profile.branch
          ? profile
          : SerametPrintService.getBranchHardwareProfile(order.branch);
      const job = SerametPrintService.createDocumentJob(targetProfile, order, documentType);
      const queued = processJobs([job], jobs, targetProfile);
      return { jobs: [job], skipped: [], queue: queued };
    } catch (error) {
      return unavailableResult(
        jobs,
        error instanceof Error ? error.message : "Printing is not configured for this branch",
      );
    }
  };

  const retryJob = (jobId: string) => {
    if (!profile) return;
    const target = jobs.find((job) => job.id === jobId);
    if (!target) return;
    if (bridgeConfigReady(bridgeConfig)) {
      setJobs((current) =>
        current.map((job) =>
          job.id === jobId
            ? clearFailureReason(job, {
                status: "Retrying",
                retryCount: job.retryCount + 1,
              })
            : job,
        ),
      );
      void sendInstalledBridgeJob(
        { ...target, status: "Retrying", retryCount: target.retryCount + 1 },
        profile,
        bridgeConfig,
        setJobs,
      );
      return;
    }
    setJobs((current) => SerametPrintService.retryJob(profile, current, jobId));
  };

  const printAtFallback = (jobId: string) => {
    if (!profile) return;
    setJobs((current) => SerametPrintService.printAtFallback(profile, current, jobId));
  };

  const reprintJob = (
    jobId: string,
    requestedBy: string,
    reason = "Operator requested duplicate copy",
  ): ReprintQueueResult | undefined => {
    if (!profile) return undefined;
    const original = jobs.find((job) => job.id === jobId);
    if (!original) return undefined;
    const result = SerametPrintService.createReprintJob(
      profile,
      original,
      requestedBy,
      reason,
      jobs,
    );
    setReprints((current) => [result.log, ...current]);
    if (!result.job) {
      return result.skipped
        ? { queue: jobs, log: result.log, skipped: result.skipped }
        : { queue: jobs, log: result.log };
    }
    const queued = processJobs([result.job], jobs, profile);
    return { queue: queued, log: result.log };
  };

  const cancelJob = (jobId: string) => {
    setJobs((current) => SerametPrintService.cancelJob(current, jobId));
  };

  return {
    profile,
    configurationError,
    jobs,
    reprints,
    bridgeConfig,
    sendKitchenTickets,
    deliverDurableKitchenPrints,
    durableTicketWarning,
    printCustomerDocument,
    retryJob,
    printAtFallback,
    reprintJob,
    cancelJob,
  };
}

function unavailableResult(jobs: PrintJob[], reason: string | null): QueueResult {
  return {
    jobs: [],
    skipped: [reason ?? "Printing is not configured for this branch"],
    queue: jobs,
  };
}

async function sendInstalledBridgeJob(
  job: PrintJob,
  profile: BranchHardwareProfile,
  config: InstalledPrintBridgeConfig,
  setJobs: Dispatch<SetStateAction<PrintJob[]>>,
) {
  if (job.printerId === "KDS-DISPLAY") {
    updateJob(setJobs, job.id, {
      status: "Displayed",
      printedAt: formatDateTime(new Date(), { hour12: false }),
      failureReason: null,
    });
    return;
  }

  updateJob(setJobs, job.id, { status: "Sending", failureReason: null });
  const primary = profile.printers.find((printer) => printer.id === job.printerId);
  try {
    let result = await submitCopies(job, config, primary?.name);
    if (!result.accepted) {
      const fallback = findRuntimeFallback(profile, job, primary?.id);
      if (fallback) {
        result = await submitCopies({ ...job, printerId: fallback.id }, config, fallback.name);
        if (result.accepted) {
          updateJob(setJobs, job.id, {
            status: "Fallback Printed",
            printerId: fallback.id,
            fallbackPrinterId: fallback.id,
            printedAt: formatDateTime(new Date(), { hour12: false }),
            failureReason: null,
          });
          return;
        }
      }
    }

    if (!result.accepted) {
      updateJob(setJobs, job.id, {
        status: "Failed",
        failureReason: result.message,
      });
      return;
    }

    updateJob(setJobs, job.id, {
      status: "Printed",
      printedAt: formatDateTime(new Date(), { hour12: false }),
      failureReason: null,
    });
  } catch (error) {
    updateJob(setJobs, job.id, {
      status: "Failed",
      failureReason: error instanceof Error ? error.message : "Local print bridge request failed",
    });
  }
}

async function submitCopies(
  job: PrintJob,
  config: InstalledPrintBridgeConfig,
  printerName?: string,
) {
  let last = { accepted: true, message: "Printed" };
  for (let copy = 0; copy < Math.max(1, job.copies); copy += 1) {
    last = await SerametLocalPrintBridge.submitToInstalledBridge(
      { ...job, copies: 1 },
      config.token,
      config.endpoint,
      printerName,
    );
    if (!last.accepted) return last;
  }
  return last;
}

function findRuntimeFallback(profile: BranchHardwareProfile, job: PrintJob, primaryId?: string) {
  const route = profile.documentRoutes[job.documentType];
  const primary = profile.printers.find((printer) => printer.id === primaryId);
  const deviceFallback = primary?.fallbackPrinterId
    ? profile.printers.find((printer) => printer.id === primary.fallbackPrinterId)
    : undefined;
  const roleFallback = route.fallbackRole
    ? profile.printers.find((printer) => printer.roles.includes(route.fallbackRole!))
    : undefined;
  const frontFallback = profile.printers.find((printer) => printer.roles.includes("FRONT"));
  return [deviceFallback, roleFallback, frontFallback].find(
    (printer) => printer && printer.id !== primaryId && printer.connection !== "Offline",
  );
}

function updateJob(
  setJobs: Dispatch<SetStateAction<PrintJob[]>>,
  jobId: string,
  patch: Omit<Partial<PrintJob>, "failureReason"> & { failureReason?: string | null },
) {
  setJobs((current) => current.map((job) => (job.id === jobId ? applyJobPatch(job, patch) : job)));
}

function clearFailureReason(job: PrintJob, patch: Partial<PrintJob>): PrintJob {
  const { failureReason: _failureReason, ...clean } = job;
  return { ...clean, ...patch };
}

function applyJobPatch(
  job: PrintJob,
  patch: Omit<Partial<PrintJob>, "failureReason"> & { failureReason?: string | null },
): PrintJob {
  if (patch.failureReason !== null) return { ...job, ...patch } as PrintJob;
  const { failureReason: _failureReason, ...cleanJob } = job;
  const { failureReason: _clear, ...cleanPatch } = patch;
  return { ...cleanJob, ...cleanPatch };
}
