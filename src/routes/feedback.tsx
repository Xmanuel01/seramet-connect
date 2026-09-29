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

export const Route = createFileRoute("/feedback")({
  head: () => ({ meta: [{ title: "Customer Feedback - Seramet" }] }),
  component: Feedback,
});

type FeedbackRow = {
  id: string;
  customer_id?: string;
  display_name?: string;
  order_id?: string;
  category: string;
  survey_type: string;
  rating: number;
  comment?: string;
  status: string;
  owner_id?: string;
  submitted_at: string;
};
type CategoryRow = { id: string; code: string; name: string; active: number };

function Feedback() {
  const { branchId, branchLabel } = useAppContext();
  const { command, scopedPath } = useCrmApi();
  const feedback = useCrmQuery<{ feedback: FeedbackRow[] }>(
    scopedPath("/api/seramet/crm/feedback?limit=200"),
  );
  const categories = useCrmQuery<{ categories: CategoryRow[] }>(
    "/api/seramet/crm/feedback/categories",
  );
  const customers = useCrmQuery<{ customers: CustomerSummary[] }>(
    scopedPath("/api/seramet/crm/customers?limit=100"),
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({
    customerId: "",
    categoryId: "",
    surveyType: "GENERAL",
    rating: "5",
    comment: "",
  });
  const rows = feedback.data?.feedback ?? [];
  const npsRows = rows.filter((row) => row.survey_type === "NPS");
  const nps = npsRows.length
    ? Math.round(
        ((npsRows.filter((row) => row.rating >= 9).length -
          npsRows.filter((row) => row.rating <= 6).length) *
          100) /
          npsRows.length,
      )
    : null;
  const csatRows = rows.filter((row) => row.survey_type === "CSAT");
  const csat = csatRows.length
    ? csatRows.reduce((sum, row) => sum + row.rating, 0) / csatRows.length
    : null;

  const submit = async () => {
    if (!form.categoryId) return;
    setBusy("create");
    try {
      await command("/api/seramet/crm/feedback", {
        branchId,
        ...(form.customerId ? { customerId: form.customerId } : {}),
        categoryId: form.categoryId,
        surveyType: form.surveyType,
        rating: Number(form.rating),
        ...(form.comment.trim() ? { comment: form.comment.trim() } : {}),
        source: "OPERATOR_ENTRY",
      });
      setCreateOpen(false);
      setForm({ customerId: "", categoryId: "", surveyType: "GENERAL", rating: "5", comment: "" });
      setNotice("Feedback recorded for service follow-up. It is not employee misconduct evidence.");
      await feedback.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Feedback could not be recorded");
    } finally {
      setBusy("");
    }
  };
  const transition = async (id: string, status: "IN_REVIEW" | "FOLLOW_UP" | "RESOLVED") => {
    setBusy(id);
    try {
      await command("/api/seramet/crm/feedback/resolve", {
        feedbackId: id,
        status,
        note: `Moved to ${status} from the feedback queue`,
      });
      await feedback.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Feedback status could not be updated");
    } finally {
      setBusy("");
    }
  };

  return (
    <AppShell
      title="Customer feedback"
      subtitle={`NPS, CSAT and service recovery queue - ${branchLabel}`}
      actions={
        <Btn variant="primary" onClick={() => setCreateOpen(true)}>
          Record feedback
        </Btn>
      }
    >
      {notice && (
        <div className="mb-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] font-medium">
          {notice}
        </div>
      )}
      {feedback.status === "loading" && !feedback.data ? (
        <CrmLoading />
      ) : feedback.status === "error" ? (
        <Panel>
          <CrmError message={feedback.error} retry={() => void feedback.refresh()} />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Responses" value={rows.length} />
            <Metric
              label="Open"
              value={rows.filter((row) => !["RESOLVED", "DISMISSED"].includes(row.status)).length}
            />
            <Metric label="NPS" value={nps ?? "Insufficient data"} />
            <Metric
              label="CSAT"
              value={csat === null ? "Insufficient data" : csat.toFixed(1)}
              suffix={csat === null ? "" : "/10"}
            />
          </div>
          <Panel className="mt-4">
            <PanelHead
              title="Feedback queue"
              sub="Compensation requires a separate authoritative reward or voucher workflow"
            />
            {!rows.length ? (
              <CrmEmpty
                title="No feedback"
                body="Responses and operator-recorded service feedback appear here."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <TH>Submitted</TH>
                      <TH>Customer / order</TH>
                      <TH>Category</TH>
                      <TH>Survey</TH>
                      <TH className="text-right">Rating</TH>
                      <TH>Comment</TH>
                      <TH>Status</TH>
                      <TH>Action</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <TD>{shortDate(row.submitted_at)}</TD>
                        <TD>
                          <div className="font-semibold">{row.display_name ?? "Anonymous"}</div>
                          <div className="num text-[11px] text-muted-foreground">
                            {row.order_id ?? "No linked order"}
                          </div>
                        </TD>
                        <TD>{row.category}</TD>
                        <TD>{readableStatus(row.survey_type)}</TD>
                        <TD className="num text-right font-semibold">{row.rating}/10</TD>
                        <TD className="max-w-[260px]">
                          <span className="line-clamp-2 text-[12px] text-muted-foreground">
                            {row.comment || "No comment"}
                          </span>
                        </TD>
                        <TD>
                          <Status>{readableStatus(row.status)}</Status>
                        </TD>
                        <TD>
                          <div className="flex gap-1">
                            {row.status === "OPEN" && (
                              <Btn
                                className="h-7 px-2 text-[11px]"
                                disabled={busy === row.id}
                                onClick={() => void transition(row.id, "IN_REVIEW")}
                              >
                                Review
                              </Btn>
                            )}
                            {["OPEN", "IN_REVIEW"].includes(row.status) && (
                              <Btn
                                className="h-7 px-2 text-[11px]"
                                disabled={busy === row.id}
                                onClick={() => void transition(row.id, "FOLLOW_UP")}
                              >
                                Follow up
                              </Btn>
                            )}
                            {!["RESOLVED", "DISMISSED"].includes(row.status) && (
                              <Btn
                                variant="primary"
                                className="h-7 px-2 text-[11px]"
                                disabled={busy === row.id}
                                onClick={() => void transition(row.id, "RESOLVED")}
                              >
                                Resolve
                              </Btn>
                            )}
                          </div>
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
        <DialogContent className="max-w-[560px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>Record customer feedback</DialogTitle>
            <DialogDescription>
              Link a customer only when known. General ratings do not become NPS or CSAT unless that
              survey type is selected.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Select
              label="Customer (optional)"
              value={form.customerId}
              onChange={(value) => setForm((current) => ({ ...current, customerId: value }))}
              options={[
                { value: "", label: "Anonymous" },
                ...(customers.data?.customers.map((customer) => ({
                  value: customer.id,
                  label: customer.displayName,
                })) ?? []),
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Category"
                value={form.categoryId}
                onChange={(value) => setForm((current) => ({ ...current, categoryId: value }))}
                options={[
                  { value: "", label: "Select category" },
                  ...(categories.data?.categories
                    .filter((category) => category.active)
                    .map((category) => ({ value: category.id, label: category.name })) ?? []),
                ]}
              />
              <Select
                label="Survey type"
                value={form.surveyType}
                onChange={(value) => setForm((current) => ({ ...current, surveyType: value }))}
                options={["GENERAL", "NPS", "CSAT"].map((value) => ({
                  value,
                  label: readableStatus(value),
                }))}
              />
            </div>
            <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
              Rating: {form.rating}/10
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                value={form.rating}
                onChange={(event) =>
                  setForm((current) => ({ ...current, rating: event.target.value }))
                }
              />
            </label>
            <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
              Comment
              <textarea
                value={form.comment}
                onChange={(event) =>
                  setForm((current) => ({ ...current, comment: event.target.value.slice(0, 2000) }))
                }
                className="min-h-24 rounded-md border border-border bg-card p-3 text-[13px] text-foreground outline-none focus:border-primary"
              />
            </label>
            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Btn onClick={() => setCreateOpen(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                disabled={busy === "create" || !form.categoryId}
                onClick={() => void submit()}
              >
                {busy === "create" ? "Saving..." : "Save feedback"}
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
