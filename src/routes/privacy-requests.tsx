import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { CrmEmpty, CrmError, CrmLoading, readableStatus, shortDate } from "@/crm/crm-ui";
import type { CustomerSummary } from "@/crm/types";
import { useCrmApi, useCrmQuery } from "@/crm/use-crm";
import { useAppContext } from "@/lib/app-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/privacy-requests")({
  head: () => ({ meta: [{ title: "Privacy Requests - Seramet" }] }),
  component: PrivacyRequests,
});

type PrivacyRow = {
  id: string;
  customer_id: string;
  display_name: string;
  request_type: string;
  status: string;
  request_reference: string;
  requested_at: string;
  completed_at?: string;
};

function PrivacyRequests() {
  const { branchLabel } = useAppContext();
  const { command, scopedPath } = useCrmApi();
  const requests = useCrmQuery<{ requests: PrivacyRow[] }>(
    scopedPath("/api/seramet/crm/privacy?limit=200"),
  );
  const customers = useCrmQuery<{ customers: CustomerSummary[] }>(
    scopedPath("/api/seramet/crm/customers?limit=100"),
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ customerId: "", requestType: "ACCESS", requestReference: "" });
  const rows = requests.data?.requests ?? [];

  const create = async () => {
    if (!form.customerId || !form.requestReference.trim()) return;
    setBusy("create");
    try {
      await command("/api/seramet/crm/privacy", {
        customerId: form.customerId,
        requestType: form.requestType,
        requestReference: form.requestReference.trim(),
      });
      setCreateOpen(false);
      setForm({ customerId: "", requestType: "ACCESS", requestReference: "" });
      setNotice(
        ["ACCESS", "EXPORT"].includes(form.requestType)
          ? "Privacy export queued through the durable worker."
          : "Privacy request recorded for authorized review.",
      );
      await requests.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Privacy request could not be created");
    } finally {
      setBusy("");
    }
  };
  const anonymize = async (requestId: string) => {
    setBusy(requestId);
    try {
      await command("/api/seramet/crm/privacy/anonymize", {
        requestId,
        reason: "Verified privacy request approved by authorized operator",
      });
      setNotice(
        "Customer identifiers anonymized while financial records and references were preserved.",
      );
      await requests.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Anonymization could not be completed");
    } finally {
      setBusy("");
    }
  };

  return (
    <AppShell
      title="Privacy requests"
      subtitle={`Authorized access, export, correction and anonymization workflow - ${branchLabel}`}
      actions={
        <Btn variant="primary" onClick={() => setCreateOpen(true)}>
          New request
        </Btn>
      }
    >
      {notice && (
        <div className="mb-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] font-medium">
          {notice}
        </div>
      )}
      {requests.status === "loading" && !requests.data ? (
        <CrmLoading />
      ) : requests.status === "error" ? (
        <Panel>
          <CrmError message={requests.error} retry={() => void requests.refresh()} />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Requests" value={rows.length} />
            <Metric
              label="Open"
              value={rows.filter((row) => !["COMPLETED", "REJECTED"].includes(row.status)).length}
            />
            <Metric
              label="Exports"
              value={rows.filter((row) => ["ACCESS", "EXPORT"].includes(row.request_type)).length}
            />
            <Metric
              label="Completed"
              value={rows.filter((row) => row.status === "COMPLETED").length}
            />
          </div>
          <Panel className="mt-4">
            <PanelHead
              title="Privacy request register"
              sub="Financial records remain intact; direct identifiers are minimized or anonymized where permitted"
            />
            {!rows.length ? (
              <CrmEmpty
                title="No privacy requests"
                body="Authorized customer privacy requests will appear here."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <TH>Requested</TH>
                      <TH>Customer</TH>
                      <TH>Request</TH>
                      <TH>Reference</TH>
                      <TH>Status</TH>
                      <TH>Completed</TH>
                      <TH>Action</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <TD>{shortDate(row.requested_at)}</TD>
                        <TD>
                          <div className="font-semibold">{row.display_name}</div>
                          <div className="num text-[11px] text-muted-foreground">
                            {row.customer_id}
                          </div>
                        </TD>
                        <TD>{readableStatus(row.request_type)}</TD>
                        <TD>{row.request_reference}</TD>
                        <TD>
                          <Status>{readableStatus(row.status)}</Status>
                        </TD>
                        <TD>{shortDate(row.completed_at)}</TD>
                        <TD>
                          {["ANONYMIZATION", "DELETION_WHERE_PERMITTED"].includes(
                            row.request_type,
                          ) && row.status !== "COMPLETED" ? (
                            <Btn
                              variant="danger"
                              className="h-7 px-2 text-[11px]"
                              disabled={busy === row.id}
                              onClick={() => void anonymize(row.id)}
                            >
                              {busy === row.id ? "Processing..." : "Anonymize"}
                            </Btn>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              Worker/review flow
                            </span>
                          )}
                        </TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-[540px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>New privacy request</DialogTitle>
            <DialogDescription>
              Only authorized staff may create and process requests. Verify the customer before
              submission.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Select
              label="Customer"
              value={form.customerId}
              onChange={(value) => setForm((current) => ({ ...current, customerId: value }))}
              options={[
                { value: "", label: "Select verified customer" },
                ...(customers.data?.customers.map((customer) => ({
                  value: customer.id,
                  label: `${customer.displayName} - ${customer.customerCode}`,
                })) ?? []),
              ]}
            />
            <Select
              label="Request type"
              value={form.requestType}
              onChange={(value) => setForm((current) => ({ ...current, requestType: value }))}
              options={[
                "ACCESS",
                "EXPORT",
                "CORRECTION",
                "ANONYMIZATION",
                "DELETION_WHERE_PERMITTED",
                "MARKETING_OPTOUT",
              ].map((value) => ({ value, label: readableStatus(value) }))}
            />
            <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
              Verification reference
              <input
                value={form.requestReference}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    requestReference: event.target.value.slice(0, 128),
                  }))
                }
                className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary"
              />
            </label>
            <div className="rounded-md bg-warning-soft px-3 py-2 text-[12px] text-warning">
              Do not place identity documents or raw sensitive data in the reference field.
            </div>
            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Btn onClick={() => setCreateOpen(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                disabled={busy === "create" || !form.customerId || !form.requestReference.trim()}
                onClick={() => void create()}
              >
                {busy === "create" ? "Submitting..." : "Submit request"}
              </Btn>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
