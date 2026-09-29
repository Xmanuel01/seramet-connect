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

type QueueResult = PrintPlanResult & { queue: PrintJob[] };
type ReprintQueueResult = { queue: PrintJob[]; log: ReprintLogEntry; skipped?: string };

export function useSerametPrintQueue(
  branch: string,
  onJobStatus?: (job: PrintJob) => void,
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
  const recoveredQueuedBranchRef = useRef("");

  useEffect(() => {
    const onConfig = () => setBridgeConfig(loadInstalledPrintBridgeConfig());
    window.addEventListener("seramet:print-bridge-config-change", onConfig);
    return () => window.removeEventListener("seramet:print-bridge-config-change", onConfig);
  }, []);

  const processJobs = (
    nextJobs: PrintJob[],
    existingJobs: PrintJob[],
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
      const processed = [...processedNext, ...existingJobs];
      setJobs(processed);
      return processed;
    }

    const queued = [...nextJobs, ...existingJobs];
    setJobs(queued);
    nextJobs.forEach((job) => {
      void sendInstalledBridgeJob(job, targetProfile, bridgeConfig, setJobs, onJobStatus);
    });
    return queued;
  };

  useEffect(() => {
    if (!profile || !bridgeConfigReady(bridgeConfig)) return;
    if (recoveredQueuedBranchRef.current === branch) return;
    recoveredQueuedBranchRef.current = branch;
    for (const job of jobs.filter((candidate) => candidate.status === "Queued")) {
      void sendInstalledBridgeJob(job, profile, bridgeConfig, setJobs, onJobStatus);
    }
  }, [branch, bridgeConfig, jobs, onJobStatus, profile, setJobs]);

  const enqueue = (nextJobs: PrintJob[]): QueueResult => {
    if (!profile) return unavailableResult(jobs, configurationError);
    const queued = processJobs(nextJobs, jobs, profile);
    return { jobs: nextJobs, skipped: [], queue: queued };
  };

  const sendKitchenTickets = (
    order: OrderForPrint,
    amendmentType: "NEW" | "ADDITION" | "VOID" | "REPRINT" = "NEW",
    obligationIdsByStation: Record<string, string> = {},
  ): QueueResult => {
    if (!profile) return unavailableResult(jobs, configurationError);
    const plan = SerametPrintService.createProductionTicketJobs(
      profile,
      order,
      jobs,
      amendmentType,
      obligationIdsByStation,
    );
    const queued = processJobs(plan.jobs, jobs, profile);
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
  onJobStatus?: (job: PrintJob) => void,
) {
  if (job.printerId === "KDS-DISPLAY") {
    const displayed = {
      ...job,
      status: "Displayed" as const,
      printedAt: formatDateTime(new Date(), { hour12: false }),
    };
    updateJob(setJobs, job.id, { status: displayed.status, printedAt: displayed.printedAt, failureReason: null });
    onJobStatus?.(displayed);
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
          const printedAt = formatDateTime(new Date(), { hour12: false });
          updateJob(setJobs, job.id, {
            status: "Fallback Printed", printerId: fallback.id, fallbackPrinterId: fallback.id,
            printedAt, failureReason: null,
          });
          onJobStatus?.({ ...job, status: "Fallback Printed", printerId: fallback.id, fallbackPrinterId: fallback.id, printedAt });
          return;
        }
      }
    }

    if (!result.accepted) {
      updateJob(setJobs, job.id, { status: "Failed", failureReason: result.message });
      onJobStatus?.({ ...job, status: "Failed", failureReason: result.message });
      return;
    }

    const printedAt = formatDateTime(new Date(), { hour12: false });
    updateJob(setJobs, job.id, { status: "Printed", printedAt, failureReason: null });
    onJobStatus?.({ ...job, status: "Printed", printedAt });
  } catch (error) {
    const failureReason =
      error instanceof Error ? error.message : "Local print bridge request outcome is uncertain";
    updateJob(setJobs, job.id, { status: "Uncertain", failureReason });
    onJobStatus?.({ ...job, status: "Uncertain", failureReason });
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
