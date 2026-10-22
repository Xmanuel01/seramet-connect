import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RefreshCcw, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Btn, TD, TH } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import { getSerametAccessToken } from "@/lib/access-token";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { permissions } from "@/platform/permissions";
import type { ImportPreview } from "@/onboarding/types";
import { inventoryUploadKey } from "@/inventory/import-identity";

type Pending = { jobId?: string; importId?: string };
export function InventoryImport({ onPublished }: { onPublished: () => void }) {
  const { activeTenantId, branchId, currentUser, isAllBranches, hasPermission } = useAppContext();
  const allowed = hasPermission(permissions.setupImport) && !isAllBranches;
  return allowed ? (
    <ScopedImport
      key={JSON.stringify([activeTenantId, branchId, currentUser.id])}
      onPublished={onPublished}
    />
  ) : null;
}
function ScopedImport({ onPublished }: { onPublished: () => void }) {
  const { activeTenantId, branchId, currentUser } = useAppContext();
  const storage = `seramet.inventory-import:${activeTenantId}:${branchId}:${currentUser.id}`;
  const [open, setOpen] = useState(false);
  const [capability, setCapability] = useState<{ available: boolean; reason?: string } | null>(
    null,
  );
  const [pending, setPending] = useState<Pending>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(storage) ?? "{}");
      return value &&
        typeof value === "object" &&
        [value.jobId, value.importId].every((x) => x === undefined || typeof x === "string")
        ? value
        : {};
    } catch {
      return {};
    }
  });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [skip, setSkip] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [stage, setStage] = useState("");
  const [page, setPage] = useState(0);
  const lock = useRef(false);
  const active = useRef(true);
  const published = useRef(onPublished);
  useEffect(() => {
    published.current = onPublished;
  }, [onPublished]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const api = useCallback(
    async (path: string, body?: unknown, signal?: AbortSignal) => {
      const token = getSerametAccessToken();
      const response = await authenticatedFetch(`/api/seramet/setup/imports${path}`, {
        ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
        headers: {
          "content-type": "application/json",
          "x-seramet-tenant-id": activeTenantId,
          "x-seramet-branch-id": branchId,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message ?? "Inventory import request was not confirmed");
      return result;
    },
    [activeTenantId, branchId],
  );
  const remember = useCallback(
    (value: Pending) => {
      if (!active.current) return;
      setPending(value);
      try {
        sessionStorage.setItem(storage, JSON.stringify(value));
      } catch {
        /* Server job remains recoverable. */
      }
    },
    [storage],
  );
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let capabilityChecked = false;
    let lastState = "";
    const poll = async () => {
      if (document.hidden) {
        timer = setTimeout(() => void poll(), 2000);
        return;
      }
      try {
        if (!capabilityChecked) {
          const availability = await api("/capability", undefined, controller.signal);
          if (controller.signal.aborted) return;
          setCapability(availability.capability);
          capabilityChecked = true;
        }
        let importId = pending.importId;
        let running = Boolean(pending.jobId && !importId);
        if (!importId && pending.jobId) {
          const { job } = await api(
            `/jobs/${encodeURIComponent(pending.jobId)}`,
            undefined,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          if (["FAILED", "DEAD_LETTER"].includes(job.status))
            throw new Error(
              job.error ?? "File scan or preparation failed. The file remains unavailable.",
            );
          setStage(job.result?.pipelineState ?? job.status);
          importId = job.result?.importId;
          if (importId) remember({ jobId: pending.jobId, importId });
        }
        if (importId) {
          const { result: status } = await api(
            `/${encodeURIComponent(importId)}/status`,
            undefined,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          const state = `${status.status}:${status.publishStatus}`;
          if (state !== lastState) {
            const { preview: result } = await api(
              `/${encodeURIComponent(importId)}`,
              undefined,
              controller.signal,
            );
            if (controller.signal.aborted) return;
            if (result.kind !== "INVENTORY" || !result.targetBranchIds?.includes(branchId))
              throw new Error("Import does not belong to this branch");
            setPreview(result);
            lastState = state;
          }
          setStage(status.publishStatus === "PUBLISHED" ? "PUBLISHED" : status.status);
          running = status.status === "COMMITTING" || status.publishStatus === "PUBLISHING";
          if (status.publishStatus === "PUBLISHED") {
            published.current();
            return;
          }
        }
        setReadError("");
        if (running) timer = setTimeout(() => void poll(), 2000);
      } catch (cause) {
        if (!controller.signal.aborted)
          setReadError(cause instanceof Error ? cause.message : "Import status unavailable");
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, pending.jobId, pending.importId, revision, api, remember, branchId]);
  async function run(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "Import not confirmed");
    } finally {
      lock.current = false;
      if (active.current) {
        setBusy(false);
        setRevision((x) => x + 1);
      }
    }
  }
  async function upload(file: File) {
    if (
      !capability?.available ||
      !/\.(csv|xlsx)$/i.test(file.name) ||
      file.size === 0 ||
      file.size > 10 * 1024 * 1024
    )
      throw new Error("Select a CSV or XLSX file up to 10 MB when secure scanning is available");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const { job } = await api("/uploads", {
      kind: "INVENTORY",
      branchId,
      originalName: file.name,
      mimeType: file.type || "application/octet-stream",
      base64: btoa(binary),
      duplicateStrategy: skip ? "SKIP" : "ERROR",
      idempotencyKey: await inventoryUploadKey({
        branchId,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        skipExisting: skip,
        fileDigest: digest,
      }),
    });
    remember({ jobId: job.jobId });
    setPreview(null);
    setStage("QUARANTINED");
    setPage(0);
  }
  function template() {
    const url = URL.createObjectURL(
      new Blob(
        [
          "code,name,categoryCode,baseUnit,dimension,warehouseId,description,trackExpiry,barcode\r\n",
        ],
        { type: "text/csv;charset=utf-8" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "inventory-template.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <Btn onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" />
        Import items
      </Btn>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl grid-cols-[minmax(0,1fr)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import inventory items</DialogTitle>
            <DialogDescription>
              Review scanned items before approving and publishing. Opening quantities and costs are
              recorded separately through authorized stock workflows.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-3">
            <Btn onClick={template}>
              <Download className="h-4 w-4" />
              Template
            </Btn>
            {pending.jobId && (
              <Btn
                disabled={
                  busy ||
                  (!(error || readError) &&
                    preview?.publishStatus !== "PUBLISHED" &&
                    preview?.status !== "FAILED")
                }
                onClick={() => {
                  remember({});
                  setPreview(null);
                  setStage("");
                  setError("");
                  setReadError("");
                }}
              >
                New file
              </Btn>
            )}
            <Btn
              disabled={busy}
              title="Refresh import status"
              onClick={() => setRevision((x) => x + 1)}
            >
              <RefreshCcw className="h-4 w-4" />
            </Btn>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={skip}
                onChange={(e) => setSkip(e.target.checked)}
                disabled={busy}
              />
              Skip existing items
            </label>
            <input
              aria-label="Inventory spreadsheet"
              className="w-full min-w-0 max-w-full text-sm"
              type="file"
              accept=".csv,.xlsx"
              disabled={
                busy ||
                !capability?.available ||
                (!!pending.jobId && preview?.publishStatus !== "PUBLISHED")
              }
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void run(() => upload(file));
              }}
            />
          </div>
          {!capability?.available && (
            <p role="status" className="text-sm">
              {capability?.reason ?? "Checking secure scanner availability..."}
            </p>
          )}
          {stage && (
            <p role="status" className="text-sm">
              Import status: {stage}
            </p>
          )}
          {pending.jobId && (
            <p className="break-all text-xs text-muted-foreground">Reference: {pending.jobId}</p>
          )}
          {(error || readError) && (
            <p role="alert" className="text-sm text-danger">
              {error || readError}
            </p>
          )}
          {preview && (
            <>
              <p className="text-sm">
                {preview.rowCount} rows · {preview.errorCount} errors · {preview.warningCount}{" "}
                warnings
              </p>
              <div className="min-w-0 overflow-x-auto">
                <table className="w-full min-w-[620px]">
                  <thead>
                    <tr>
                      <TH>Code</TH>
                      <TH>Item</TH>
                      <TH>Category</TH>
                      <TH>Action</TH>
                      <TH>Issues</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(page * 20, page * 20 + 20).map((row) => (
                      <tr key={row.rowNumber}>
                        <TD>{row.rowKey}</TD>
                        <TD>{String(row.normalized.name ?? "")}</TD>
                        <TD>{String(row.normalized.categoryCode ?? "")}</TD>
                        <TD>{row.action}</TD>
                        <TD>{[...row.errors, ...row.warnings].map((x) => x.message).join("; ")}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <Btn disabled={page === 0} onClick={() => setPage((x) => x - 1)}>
                  Previous
                </Btn>
                <Btn
                  disabled={(page + 1) * 20 >= preview.rowCount}
                  onClick={() => setPage((x) => x + 1)}
                >
                  Next
                </Btn>
              </div>
              {preview.canCommit && (
                <Btn
                  variant="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/${preview.id}/commit`, { idempotencyKey: preview.commitKey });
                    })
                  }
                >
                  Approve immutable plan
                </Btn>
              )}
              {preview.publishStatus === "READY" && (
                <Btn
                  variant="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/${preview.id}/publish`, { idempotencyKey: preview.publishKey });
                    })
                  }
                >
                  Confirm and publish inventory
                </Btn>
              )}
              {preview.publishStatus === "PUBLISHED" && (
                <p role="status" className="text-sm text-success">
                  Published and verified. Existing stock balances were not changed.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
