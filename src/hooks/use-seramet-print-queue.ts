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
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { useAppContext } from "@/lib/app-context";

type QueueResult = PrintPlanResult & { queue: PrintJob[] };
type ReprintQueueResult = { queue: PrintJob[]; log: ReprintLogEntry; skipped?: string };
/** Bridge acceptance is NOT proof of physical printing. */
type OnKitchenDelivery = (job: PrintJob, result: "BRIDGE_ACCEPTED" | "UNCERTAIN") => void;

export function useSerametPrintQueue(branch: string) {
  const { activeTenantId } = useAppContext();
  const queueKey = `${activeTenantId}:${branch}`;
  const [configurationVersion, setConfigurationVersion] = useState(0);
  useEffect(
    () =>
      getConfigurationRepository().subscribe(() =>
        setConfigurationVersion((version) => version + 1),
      ),
    [],
  );
  const profileState = useMemo<{
    profile: BranchHardwareProfile | null;
    configurationError: string | null;
  }>(() => {
    // The repository subscription invalidates this cached adapter projection.
    void configurationVersion;
    try {
      return {
        profile: SerametPrintService.getBranchHardwareProfile(branch, activeTenantId),
        configurationError: null,
      };
    } catch (error) {
      return {
        profile: null,
        configurationError:
          error instanceof Error ? error.message : "Printing is not configured for this branch",
      };
    }
  }, [branch, activeTenantId, configurationVersion]);
  const { profile, configurationError } = profileState;
  const subscribeToQueue = useCallback(
    (listener: () => void) => DevicePrintQueueStore.subscribe(queueKey, listener),
    [queueKey],
  );
  const readQueue = useCallback(() => DevicePrintQueueStore.snapshot(queueKey), [queueKey]);
  const queue = useSyncExternalStore(subscribeToQueue, readQueue, readQueue);
  const jobs = queue.jobs;
  const reprints = queue.reprints;
  const setJobs = useCallback<Dispatch<SetStateAction<PrintJob[]>>>(
    (update) => DevicePrintQueueStore.setJobs(queueKey, update),
    [queueKey],
  );
  const setReprints = useCallback<Dispatch<SetStateAction<ReprintLogEntry[]>>>(
    (update) => DevicePrintQueueStore.setReprints(queueKey, update),
    [queueKey],
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
          onKitchenDelivery(job, job.status === "Displayed" ? "BRIDGE_ACCEPTED" : "UNCERTAIN"),
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
    authorization?: { obligationId: string; claimToken: string },
  ): QueueResult => {
    if (!profile) return unavailableResult(jobs, configurationError);
    const plan = SerametPrintService.createProductionTicketJobs(
      profile,
      order,
      jobs,
      amendmentType,
    );
    const authorizedJobs = plan.jobs.map((job) => ({ ...job, ...authorization }));
    const queued = processJobs(authorizedJobs, jobs, profile, onKitchenDelivery);
    return { ...plan, jobs: authorizedJobs, queue: queued };
  };

  const printCustomerDocument = (
    order: OrderForPrint,
    documentType: "BILL" | "RECEIPT" | "INVOICE",
    reprint?: { reprintReason: string; authorizationReprintId: string },
  ): QueueResult => {
    if (!profile) return unavailableResult(jobs, configurationError);
    try {
      const targetProfile =
        order.branch === profile.branch
          ? profile
          : SerametPrintService.getBranchHardwareProfile(order.branch, activeTenantId);
      const job = {
        ...SerametPrintService.createDocumentJob(targetProfile, order, documentType),
        ...reprint,
      };
      const queued = processJobs([job], jobs, targetProfile);
      return { jobs: [job], skipped: [], queue: queued };
    } catch (error) {
      return unavailableResult(
        jobs,
        error instanceof Error ? error.message : "Printing is not configured for this branch",
      );
    }
  };

  const retryJob = (_jobId: string) => {
    window.location.assign("/seramet-printers");
  };
  const printAtFallback = (_jobId: string) => {
    window.location.assign("/seramet-printers");
  };
  const reprintJob = (
    jobId: string,
    requestedBy: string,
    reason: string,
  ): ReprintQueueResult | undefined => {
    if (!profile) return undefined;
    const original = jobs.find((job) => job.id === jobId);
    if (!original) return undefined;
    if (["FOOD_KOT", "BAR_TICKET", "DISPATCH_TICKET"].includes(original.documentType)) {
      window.location.assign("/seramet-printers");
      return undefined;
    }
    if (reason.trim().length < 12) return undefined;
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
    const queued = processJobs(
      [
        {
          ...result.job,
          reprintReason: reason.trim(),
          authorizationReprintId: crypto.randomUUID(),
        },
      ],
      jobs,
      profile,
    );
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
    // Fallback is safe only before the first submission, when a known offline
    // primary could not have produced paper. NEVER resend after an ambiguous
    // bridge rejection or timeout, including partially accepted multi-copies.
    const fallback =
      primary?.connection === "Offline" ? findRuntimeFallback(profile, job, primary.id) : undefined;
    const target = fallback ? { ...job, printerId: fallback.id } : job;
    const response = await submitCopies(target, config, fallback?.name ?? primary?.name);
    if (!response.accepted) {
      updateJob(setJobs, job.id, {
        status: "Failed",
        failureReason: response.message,
      });
      return;
    }
    updateJob(setJobs, job.id, {
      status: "Bridge accepted",
      ...(fallback ? { printerId: fallback.id, fallbackPrinterId: fallback.id } : {}),
      printedAt: formatDateTime(new Date(), { hour12: false }),
      failureReason: null,
    });
    outcome = "BRIDGE_ACCEPTED";
  } catch (error) {
    updateJob(setJobs, job.id, {
      status: "Failed",
      failureReason: error instanceof Error ? error.message : "Local print bridge request failed",
    });
  } finally {
    // Local HTTP success is bridge acceptance only. Ambiguous outcomes remain
    // server-side until a manager inspects the actual production station.
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
      { ...job, copies: 1, copyIndex: copy },
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
