import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AppShell } from "@/components/app/AppShell";
import { PosCustomerPicker } from "@/components/app/PosCustomerPicker";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { CrmEmpty, CrmError, CrmLoading, readableStatus, shortDate } from "@/crm/crm-ui";
import {
  crmErrorMessage,
  crmFieldClass,
  crmTextAreaClass,
  useCrmScreenQuery,
} from "@/crm/use-crm-screen";
import { useCrmApi } from "@/crm/use-crm";
import type { PosCustomerIdentity } from "@/crm/pos-customer-link";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/complaints")({
  head: () => ({ meta: [{ title: "Service feedback - Seramet" }] }),
  component: Complaints,
});

type Feedback = {
  id: string;
  customer_id: string | null;
  display_name: string | null;
  order_id: string | null;
  category: string;
  survey_type: "GENERAL" | "NPS" | "CSAT";
  rating: number;
  comment: string | null;
  status: string;
  owner_id: string | null;
  submitted_at: string;
};
type FeedbackCategory = { id: string; name: string; active: number };
type FeedbackResponse = { ok: boolean; feedback: Feedback[] };
type CategoriesResponse = { ok: boolean; categories: FeedbackCategory[] };
type Resolution = "IN_REVIEW" | "FOLLOW_UP" | "RESOLVED" | "DISMISSED";

function Complaints() {
  const { branchId, branchLabel, hasPermission } = useAppContext();
  const canView = hasPermission(permissions.feedbackView);
  const canManage = hasPermission(permissions.feedbackManage);
  const { command } = useCrmApi();
  const feedback = useCrmScreenQuery<FeedbackResponse>(
    "/api/seramet/crm/feedback?branchId=" + encodeURIComponent(branchId),
    canView,
  );
  const categories = useCrmScreenQuery<CategoriesResponse>(
    "/api/seramet/crm/feedback/categories",
    canView,
  );
  const [openForm, setOpenForm] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [survey, setSurvey] = useState<"GENERAL" | "CSAT" | "NPS">("GENERAL");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [customer, setCustomer] = useState<PosCustomerIdentity | null>(null);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolutionStatus, setResolutionStatus] = useState<Resolution>("IN_REVIEW");
  const [resolutionNote, setResolutionNote] = useState("");
  const [resolutionDetails, setResolutionDetails] = useState("");
  const [period, setPeriod] = useState("");
  const activeCategories = categories.data?.categories.filter((row) => row.active === 1) ?? [];
  const visible = (feedback.data?.feedback ?? []).filter(
    (row) => !period || row.submitted_at.slice(0, 10) === period,
  );
  const pending = visible.filter((row) => !["RESOLVED", "DISMISSED"].includes(row.status));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || busy) return;
    const chosenCategory = categoryId || activeCategories[0]?.id;
    if (!chosenCategory) {
      setActionError("Configure an active feedback category before recording a case.");
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      await command("/api/seramet/crm/feedback", {
        branchId,
        categoryId: chosenCategory,
        ...(customer ? { customerId: customer.id } : {}),
        surveyType: survey,
        rating,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        source: "STAFF_ENTRY",
      });
      setOpenForm(false);
      setCustomer(null);
      setComment("");
      setCategoryId("");
      feedback.refresh();
    } catch (error) {
      setActionError(crmErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function resolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !resolveId || busy) return;
    setBusy(true);
    setActionError("");
    try {
      await command("/api/seramet/crm/feedback/resolve", {
        feedbackId: resolveId,
        status: resolutionStatus,
        ...(resolutionNote.trim() ? { note: resolutionNote.trim() } : {}),
        ...(resolutionDetails.trim() ? { resolution: resolutionDetails.trim() } : {}),
      });
      setResolveId(null);
      setResolutionNote("");
      setResolutionDetails("");
      feedback.refresh();
    } catch (error) {
      setActionError(crmErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Complaints and feedback"
      subtitle={"Real feedback cases, follow-ups and auditable resolution - " + branchLabel}
      actions={
        canManage ? (
          <Btn variant="primary" onClick={() => setOpenForm((value) => !value)}>
            {openForm ? "Cancel" : "Record feedback"}
          </Btn>
        ) : undefined
      }
    >
      {!canView ? (
        <Panel className="p-5">
          <CrmEmpty title="Access restricted" body="Feedback viewing permission is required." />
        </Panel>
      ) : (
        <>
          {actionError && (
            <p role="alert" className="mb-3 rounded-md bg-danger-soft p-3 text-[12px] text-danger">
              {actionError}
            </p>
          )}
          {openForm && canManage && (
            <Panel className="mb-4">
              <PanelHead
                title="Record a real feedback case"
                sub="Do not invent customer or order associations."
              />
              <form onSubmit={submit} className="grid gap-3 p-4 md:grid-cols-2">
                <label className="grid gap-1 text-[12px] font-medium">
                  Feedback category
                  <select
                    required
                    className={crmFieldClass}
                    value={categoryId || activeCategories[0]?.id || ""}
                    onChange={(event) => setCategoryId(event.target.value)}
                  >
                    {activeCategories.length === 0 && (
                      <option value="">No categories configured</option>
                    )}
                    {activeCategories.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[12px] font-medium">
                  Survey type
                  <select
                    className={crmFieldClass}
                    value={survey}
                    onChange={(event) => setSurvey(event.target.value as typeof survey)}
                  >
                    <option value="GENERAL">General feedback</option>
                    <option value="CSAT">Customer satisfaction</option>
                    <option value="NPS">Net promoter score</option>
                  </select>
                </label>
                <label className="grid gap-1 text-[12px] font-medium">
                  Rating (0–10)
                  <input
                    className={crmFieldClass}
                    required
                    type="number"
                    min={0}
                    max={10}
                    value={rating}
                    onChange={(event) => setRating(Number(event.target.value))}
                  />
                </label>
                <div className="md:col-span-2">
                  <PosCustomerPicker value={customer} disabled={busy} onSelect={setCustomer} />
                </div>
                <label className="grid gap-1 text-[12px] font-medium md:col-span-2">
                  Customer's feedback
                  <textarea
                    className={crmTextAreaClass}
                    value={comment}
                    maxLength={2000}
                    onChange={(event) => setComment(event.target.value)}
                    rows={3}
                  />
                </label>
                <Btn
                  variant="primary"
                  type="submit"
                  disabled={busy || activeCategories.length === 0}
                >
                  {busy ? "Recording..." : "Record feedback"}
                </Btn>
              </form>
            </Panel>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Metric label="Visible feedback" value={visible.length} />
            <Metric label="Awaiting resolution" value={pending.length} />
            <Metric
              label="Resolved"
              value={visible.filter((row) => row.status === "RESOLVED").length}
            />
          </div>
          <Panel className="mt-4">
            <PanelHead
              title="Service cases"
              sub="Case status changes are audited; no synthetic severity or recovery metrics."
              right={<Btn onClick={feedback.refresh}>Refresh</Btn>}
            />
            <div className="flex flex-wrap gap-3 border-b border-border p-4">
              <label className="text-[12px]">
                Date
                <input
                  type="date"
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                  className={crmFieldClass}
                />
              </label>
              <Btn onClick={() => setPeriod("")}>All loaded dates</Btn>
            </div>
            {feedback.status === "loading" ? (
              <CrmLoading />
            ) : feedback.status === "error" ? (
              <CrmError message={feedback.error} retry={feedback.refresh} />
            ) : visible.length === 0 ? (
              <CrmEmpty
                title="No recorded cases"
                body="No feedback matches this branch and date."
              />
            ) : (
              <div className="divide-y divide-border">
                {visible.map((row) => (
                  <article key={row.id} className="space-y-2 p-4 text-[13px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{row.category}</strong>
                      <Status>{readableStatus(row.status)}</Status>
                    </div>
                    <p>{row.comment || "No written feedback supplied."}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {row.display_name || "Anonymous customer"} · {row.survey_type} {row.rating}/10
                      {" · "}
                      {shortDate(row.submitted_at)}
                    </p>
                    {canManage && (
                      <Btn
                        onClick={() => {
                          setResolveId(row.id);
                          setResolutionStatus("IN_REVIEW");
                          setResolutionNote("");
                          setResolutionDetails("");
                          setActionError("");
                        }}
                      >
                        Update case
                      </Btn>
                    )}
                    {resolveId === row.id && canManage && (
                      <form onSubmit={resolve} className="space-y-2 rounded-md bg-secondary/50 p-3">
                        <label className="grid gap-1 text-[12px]">
                          New status
                          <select
                            className={crmFieldClass}
                            value={resolutionStatus}
                            onChange={(event) =>
                              setResolutionStatus(event.target.value as Resolution)
                            }
                          >
                            <option value="IN_REVIEW">In review</option>
                            <option value="FOLLOW_UP">Follow up</option>
                            <option value="RESOLVED">Resolved</option>
                            <option value="DISMISSED">Dismissed</option>
                          </select>
                        </label>
                        <label className="grid gap-1 text-[12px]">
                          Internal note
                          <textarea
                            className={crmTextAreaClass}
                            value={resolutionNote}
                            maxLength={2000}
                            onChange={(event) => setResolutionNote(event.target.value)}
                          />
                        </label>
                        <label className="grid gap-1 text-[12px]">
                          Resolution details
                          <textarea
                            className={crmTextAreaClass}
                            value={resolutionDetails}
                            maxLength={2000}
                            onChange={(event) => setResolutionDetails(event.target.value)}
                          />
                        </label>
                        <div className="flex gap-2">
                          <Btn variant="primary" type="submit" disabled={busy}>
                            {busy ? "Saving..." : "Save status"}
                          </Btn>
                          <Btn type="button" onClick={() => setResolveId(null)}>
                            Cancel
                          </Btn>
                        </div>
                      </form>
                    )}
                  </article>
                ))}
              </div>
            )}
            {feedback.data?.feedback.length === 200 && (
              <p className="p-3 text-[12px] text-warning">
                Showing the latest 200 cases. Filtering older cases requires further pagination.
              </p>
            )}
          </Panel>
        </>
      )}
    </AppShell>
  );
}
