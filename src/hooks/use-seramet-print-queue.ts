import {
  useCallback,
  useEffect,
  useMemo,
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

type QueueResult = PrintPlanResult & { queue: PrintJob[] };
type ReprintQueueResult = { queue: PrintJob[]; log: ReprintLogEntry; skipped?: string };
/** Bridge acceptance is NOT proof of physical printing. */
type OnKitchenDelivery = (job: PrintJob, result: "BRIDGE_ACCEPTED" | "UNCERTAIN") => void;

export function useSerametPrintQueue(branch: string) {
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
    existingJobs: PrintJob[],
    targetProfile: BranchHardwareProfile,
    onKitchenDelivery?: OnKitchenDelivery,
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
      const processed = [...processedNext, ...existingJobs];
      setJobs(processed);
      if (onKitchenDelivery) {
        processedNext.forEach((job) =>
          onKitchenDelivery(
            job,
            job.status === "Displayed" ? "BRIDGE_ACCEPTED" : "UNCERTAIN",
          ),
        );
      }
      return processed;
    }

    const queued = [...nextJobs, ...existingJobs];
    setJobs(queued);
    nextJobs.forEach((job) => {
      void sendInstalledBridgeJob(job, targetProfile, bridgeConfig, setJobs, onKitchenDelivery);
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
    onKitchenDelivery?: OnKitchenDelivery,
  ): QueueResult => {
    if (!profile) return unavailableResult(jobs, configurationError);
    const plan = SerametPrintService.createProductionTicketJobs(
      profile,
      order,
      jobs,
      amendmentType,
    );
    const queued = processJobs(plan.jobs, jobs, profile, onKitchenDelivery);
    return { ...plan, queue: queued };
  };

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
  onKitchenDelivery?: OnKitchenDelivery,
) {
  let outcome: "BRIDGE_ACCEPTED" | "UNCERTAIN" = "UNCERTAIN";
  try {
  if (job.printerId === "KDS-DISPLAY") {
    updateJob(setJobs, job.id, {
      status: "Displayed",
      printedAt: formatDateTime(new Date(), { hour12: false }),
      failureReason: null,
    });
    outcome = "BRIDGE_ACCEPTED";
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
          outcome = "BRIDGE_ACCEPTED";
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
    outcome = "BRIDGE_ACCEPTED";
  } catch (error) {
    updateJob(setJobs, job.id, {
      status: "Failed",
      failureReason: error instanceof Error ? error.message : "Local print bridge request failed",
    });
  }
  } finally {
    // A bridge timeout may occur after actual paper delivery. Preserve that
    // uncertainty centrally; do not trigger an automatic duplicate ticket.
    onKitchenDelivery?.(job, outcome);
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
