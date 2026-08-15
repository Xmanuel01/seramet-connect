import { useMemo, useState } from "react";
import {
  SerametPrintService,
  type BranchHardwareProfile,
  type OrderForPrint,
  type PrintJob,
  type PrintPlanResult,
  type ReprintLogEntry,
} from "@/lib/seramet-print-service";

type QueueResult = PrintPlanResult & { queue: PrintJob[] };
type ReprintQueueResult = { queue: PrintJob[]; log: ReprintLogEntry; skipped?: string };

export function useSerametPrintQueue(branch: string) {
  const profile = useMemo<BranchHardwareProfile>(
    () => SerametPrintService.getBranchHardwareProfile(branch),
    [branch],
  );
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [reprints, setReprints] = useState<ReprintLogEntry[]>([]);

  const enqueue = (nextJobs: PrintJob[]): QueueResult => {
    const queued = SerametPrintService.processQueuedJobs([...nextJobs, ...jobs]);
    setJobs(queued);
    return { jobs: nextJobs, skipped: [], queue: queued };
  };

  const sendKitchenTickets = (
    order: OrderForPrint,
    amendmentType: "NEW" | "ADDITION" | "VOID" | "REPRINT" = "NEW",
  ): QueueResult => {
    const plan = SerametPrintService.createProductionTicketJobs(
      profile,
      order,
      jobs,
      amendmentType,
    );
    const queued = SerametPrintService.processQueuedJobs([...plan.jobs, ...jobs]);
    setJobs(queued);
    return { ...plan, queue: queued };
  };

  const printCustomerDocument = (
    order: OrderForPrint,
    documentType: "BILL" | "RECEIPT" | "INVOICE",
  ): QueueResult => {
    const job = SerametPrintService.createDocumentJob(profile, order, documentType);
    return enqueue([job]);
  };

  const retryJob = (jobId: string) => {
    setJobs((current) => SerametPrintService.retryJob(profile, current, jobId));
  };

  const printAtFallback = (jobId: string) => {
    setJobs((current) => SerametPrintService.printAtFallback(profile, current, jobId));
  };

  const reprintJob = (
    jobId: string,
    requestedBy: string,
    reason = "Operator requested duplicate copy",
  ): ReprintQueueResult | undefined => {
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
    if (!result.job) return { queue: jobs, log: result.log, skipped: result.skipped };
    const queued = SerametPrintService.processQueuedJobs([result.job, ...jobs]);
    setJobs(queued);
    return { queue: queued, log: result.log };
  };

  const cancelJob = (jobId: string) => {
    setJobs((current) => SerametPrintService.cancelJob(current, jobId));
  };

  return {
    profile,
    jobs,
    reprints,
    sendKitchenTickets,
    printCustomerDocument,
    retryJob,
    printAtFallback,
    reprintJob,
    cancelJob,
  };
}
