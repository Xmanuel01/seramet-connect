import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Btn } from "@/components/app/ui";
import { validateDocumentRecipient } from "@/lib/document-email";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";

const statusLabels: Record<string, string> = {
  QUEUED: "Email queued with the PDF attached. Waiting for provider acceptance.",
  PROVIDER_ACCEPTED: "Brevo accepted the email and PDF. Inbox delivery is not yet confirmed.",
  RECONCILIATION_REQUIRED:
    "Delivery outcome is uncertain. Do not send another copy until the provider records have been checked.",
  CONFIGURATION_REQUIRED:
    "Brevo is not configured for this restaurant. The request remains recorded.",
  DELIVERY_FAILED: "Email delivery failed. The invoice or financial close is unchanged.",
};
export function DocumentEmailDialog({
  title,
  documentType,
  recordId,
  close,
}: {
  title: string;
  documentType: "INVOICE" | "RECEIPT";
  recordId: string;
  close: () => void;
}) {
  const { activeTenantId, branchId, currentUser } = useAppContext();
  const storageKey = `seramet.document-email.v1:${activeTenantId}:${branchId}:${currentUser.id}:${documentType}:${recordId}`;
  const [request, setRequest] = useState<{ key: string; jobId?: string }>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (
        saved &&
        /^[a-f0-9-]{36}$/i.test(saved.key) &&
        (!saved.jobId || /^[a-f0-9-]{36}$/i.test(saved.jobId))
      )
        return saved;
    } catch {
      /* Private browsing can disable persistence. */
    }
    return { key: crypto.randomUUID() };
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState(request.jobId ? "QUEUED" : "");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "x-seramet-tenant-id": activeTenantId,
      "x-seramet-branch-id": branchId,
      ...(getSerametAccessToken() ? { Authorization: `Bearer ${getSerametAccessToken()}` } : {}),
    }),
    [activeTenantId, branchId],
  );
  const persist = (value: typeof request) => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* Keep in-memory idempotency if storage is unavailable. */
    }
    setRequest(value);
  };
  useEffect(() => {
    if (!request.jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let count = 0;
    const check = async () => {
      try {
        const response = await fetch(`/api/seramet/document-emails/${request.jobId}`, {
          headers: headers(),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const body = await response.json();
        if (!Object.hasOwn(statusLabels, body.status)) throw new Error();
        if (controller.signal.aborted) return;
        setStatus(body.status);
        if (body.status !== "QUEUED") return;
      } catch {
        if (controller.signal.aborted) return;
      }
      if (++count < 12) timer = setTimeout(check, 5000);
    };
    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [request.jobId, headers]);
  return (
    <Dialog open onOpenChange={(open) => !open && !busyRef.current && close()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle>Email {title}</DialogTitle>
          <DialogDescription>
            {statusLabels[status] ?? "Send this document as a PDF attachment."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid min-w-0 gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busyRef.current || request.jobId) return;
            try {
              const recipient = validateDocumentRecipient({ name, email });
              busyRef.current = true;
              setBusy(true);
              setError("");
              persist(request);
              const response = await fetch("/api/seramet/document-emails", {
                method: "POST",
                headers: { ...headers(), "Idempotency-Key": request.key },
                body: JSON.stringify({ documentType, recordId, recipient }),
                signal: AbortSignal.timeout(20000),
              });
              const body = await response.json().catch(() => ({}));
              if (!response.ok)
                throw new Error(body.message ?? body.error ?? "Email could not be queued.");
              if (!/^[a-f0-9-]{36}$/i.test(body.jobId) || !Object.hasOwn(statusLabels, body.status))
                throw new Error(
                  "Email acknowledgement could not be verified. Retry the same request.",
                );
              persist({ ...request, jobId: body.jobId });
              setStatus(body.status);
            } catch (failure) {
              setError(
                failure instanceof Error && failure.name !== "TimeoutError"
                  ? failure.message
                  : "Email acknowledgement is unavailable. Retry the same details; the same request key will be used.",
              );
            } finally {
              busyRef.current = false;
              setBusy(false);
            }
          }}
        >
          <label className="grid gap-1 text-sm">
            Recipient name
            <input
              required
              maxLength={120}
              autoComplete="name"
              disabled={busy || !!request.jobId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="min-w-0 rounded-md border border-border bg-background p-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Recipient email
            <input
              required
              type="email"
              maxLength={254}
              autoComplete="email"
              disabled={busy || !!request.jobId}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="min-w-0 rounded-md border border-border bg-background p-2"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Btn type="button" disabled={busy} onClick={close}>
              {request.jobId ? "Close" : "Cancel"}
            </Btn>
            {!request.jobId && (
              <Btn type="submit" variant="primary" disabled={busy}>
                {busy ? "Queueing..." : "Send PDF email"}
              </Btn>
            )}
            {status === "PROVIDER_ACCEPTED" && (
              <Btn
                type="button"
                onClick={() => {
                  persist({ key: crypto.randomUUID() });
                  setStatus("");
                  setName("");
                  setEmail("");
                }}
              >
                Send another copy
              </Btn>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
