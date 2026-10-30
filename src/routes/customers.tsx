import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";
import { CrmEmpty, CrmError, CrmLoading, readableStatus, shortDate } from "@/crm/crm-ui";
import { customerCreatePayload, customerSearchPath } from "@/crm/customer-360-model";
import { useCrmApi } from "@/crm/use-crm";
import type { CustomerProfile, CustomerSummary } from "@/crm/types";
import { useAppContext } from "@/lib/app-context";
import { formatMinor } from "@/payments/money";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/customers")({
  head: () => ({
    meta: [
      { title: "Customer 360 - Seramet" },
      {
        name: "description",
        content: "Scoped customer profiles, order history, loyalty and service records.",
      },
    ],
  }),
  component: Customers,
});

type CustomerPage = { ok: boolean; customers: CustomerSummary[]; nextCursor?: string };
type ProfileResponse = { ok: boolean; customer: CustomerProfile };
type CreateResponse = { ok: boolean; customer: { id: string } };
type NoteResponse = { ok: boolean; note: { id: string } };
type CustomerForm = {
  displayName: string;
  accountType: "INDIVIDUAL" | "CORPORATE";
  companyName: string;
  phone: string;
  email: string;
};
type ListState = {
  path: string;
  status: "loading" | "ready" | "error";
  page: CustomerPage | null;
  error: string;
};
type ProfileState = {
  key: string;
  status: "loading" | "ready" | "error";
  customer: CustomerProfile | null;
  error: string;
};
const emptyForm: CustomerForm = {
  displayName: "",
  accountType: "INDIVIDUAL",
  companyName: "",
  phone: "",
  email: "",
};

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : "Request failed. Try again.";
}

function Customers() {
  const { activeTenantId, branchId, branchLabel, isAllBranches, currency, locale, hasPermission } =
    useAppContext();
  const { request, command } = useCrmApi();
  const canView = hasPermission(permissions.crmCustomerView);
  const canManage = hasPermission(permissions.crmCustomerManage);
  const canViewValue = hasPermission(permissions.crmCustomerValueView);
  const [draftQuery, setDraftQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [backStack, setBackStack] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<ListState>({
    path: "",
    status: "loading",
    page: null,
    error: "",
  });
  const [selected, setSelected] = useState<{ id: string; scope: string } | null>(null);
  const [profile, setProfile] = useState<ProfileState>({
    key: "",
    status: "loading",
    customer: null,
    error: "",
  });
  const [profileRevision, setProfileRevision] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const scopeKey = activeTenantId + ":" + (isAllBranches ? "ALL" : branchId);
  const selectedId = selected?.scope === scopeKey ? selected.id : null;
  const listPath = useMemo(
    () =>
      canView
        ? customerSearchPath({
            query: appliedQuery,
            cursor,
            branchId,
            isAllBranches,
          })
        : null,
    [appliedQuery, branchId, canView, cursor, isAllBranches],
  );
  const listKey = scopeKey + "|" + (listPath ?? "");

  useEffect(() => {
    if (!listPath) return;
    const controller = new AbortController();
    setList({ path: listKey, status: "loading", page: null, error: "" });
    void request<CustomerPage>(listPath, { signal: controller.signal })
      .then((page) => {
        if (!controller.signal.aborted) {
          setList({ path: listKey, status: "ready", page, error: "" });
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setList({ path: listKey, status: "error", page: null, error: errorMessage(cause) });
        }
      });
    return () => controller.abort();
  }, [listKey, listPath, request, revision]);

  const profileKey = scopeKey + ":" + (selectedId ?? "");
  useEffect(() => {
    if (!canView || !selectedId) return;
    const controller = new AbortController();
    setProfile({ key: profileKey, status: "loading", customer: null, error: "" });
    void request<ProfileResponse>("/api/seramet/crm/customers/" + encodeURIComponent(selectedId), {
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) {
          setProfile({ key: profileKey, status: "ready", customer: response.customer, error: "" });
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setProfile({
            key: profileKey,
            status: "error",
            customer: null,
            error: errorMessage(cause),
          });
        }
      });
    return () => controller.abort();
  }, [canView, profileKey, profileRevision, request, selectedId]);

  const visibleList = listPath && list.path === listKey ? list : null;
  const customer =
    profile.key === profileKey && profile.status === "ready" ? profile.customer : null;

  const money = (amountMinor: number, rowCurrency?: string) =>
    formatMinor(amountMinor, rowCurrency ?? currency, locale);

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedQuery(draftQuery.trim());
    setCursor(null);
    setBackStack([]);
    setRevision((value) => value + 1);
    setSelected(null);
  };

  const createCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setCreateError("");
    try {
      const payload = customerCreatePayload({ ...form, branchId, isAllBranches });
      const result = await command<CreateResponse>("/api/seramet/crm/customers", payload);
      setShowCreate(false);
      setForm(emptyForm);
      setAppliedQuery("");
      setDraftQuery("");
      setCursor(null);
      setBackStack([]);
      setRevision((value) => value + 1);
      setSelected({ id: result.customer.id, scope: scopeKey });
    } catch (cause) {
      setCreateError(errorMessage(cause));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const saveNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage || !selectedId || savingNote || !note.trim()) return;
    setSavingNote(true);
    setNoteError("");
    try {
      await command<NoteResponse>(
        "/api/seramet/crm/customers/" + encodeURIComponent(selectedId) + "/notes",
        { note: note.trim(), visibility: "CRM" },
      );
      setNote("");
      setProfileRevision((value) => value + 1);
    } catch (cause) {
      setNoteError(errorMessage(cause));
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <AppShell
      title="Customer 360"
      subtitle={"Customer profiles, visits, loyalty and service history - " + branchLabel}
      actions={
        canManage ? (
          <Btn variant="primary" onClick={() => setShowCreate((value) => !value)}>
            {showCreate ? "Cancel" : "Add customer"}
          </Btn>
        ) : undefined
      }
    >
      {!canView ? (
        <Panel className="p-5">
          <CrmEmpty
            title="Customer access unavailable"
            body="Your role does not permit viewing customer profiles."
          />
        </Panel>
      ) : (
        <>
          {showCreate && canManage && (
            <Panel className="mb-4">
              <PanelHead
                title="New customer"
                sub="The server checks identifier uniqueness. Marketing consent is never assumed."
              />
              <form onSubmit={createCustomer} className="grid gap-3 p-4 md:grid-cols-2">
                <label className="grid gap-1 text-[12px] font-medium">
                  Customer name
                  <input
                    required
                    maxLength={160}
                    value={form.displayName}
                    onChange={(event) =>
                      setForm((value) => ({ ...value, displayName: event.target.value }))
                    }
                    className="h-10 rounded-md border border-border bg-background px-3 text-[13px]"
                  />
                </label>
                <label className="grid gap-1 text-[12px] font-medium">
                  Account type
                  <select
                    value={form.accountType}
                    onChange={(event) =>
                      setForm((value) => ({
                        ...value,
                        accountType: event.target.value as CustomerForm["accountType"],
                      }))
                    }
                    className="h-10 rounded-md border border-border bg-background px-3 text-[13px]"
                  >
                    <option value="INDIVIDUAL">Individual</option>
                    <option value="CORPORATE">Corporate</option>
                  </select>
                </label>
                {form.accountType === "CORPORATE" && (
                  <label className="grid gap-1 text-[12px] font-medium">
                    Company name
                    <input
                      required
                      maxLength={200}
                      value={form.companyName}
                      onChange={(event) =>
                        setForm((value) => ({ ...value, companyName: event.target.value }))
                      }
                      className="h-10 rounded-md border border-border bg-background px-3 text-[13px]"
                    />
                  </label>
                )}
                <label className="grid gap-1 text-[12px] font-medium">
                  Phone (optional)
                  <input
                    type="tel"
                    maxLength={64}
                    value={form.phone}
                    onChange={(event) =>
                      setForm((value) => ({ ...value, phone: event.target.value }))
                    }
                    className="h-10 rounded-md border border-border bg-background px-3 text-[13px]"
                  />
                </label>
                <label className="grid gap-1 text-[12px] font-medium">
                  Email (optional)
                  <input
                    type="email"
                    maxLength={254}
                    value={form.email}
                    onChange={(event) =>
                      setForm((value) => ({ ...value, email: event.target.value }))
                    }
                    className="h-10 rounded-md border border-border bg-background px-3 text-[13px]"
                  />
                </label>
                {createError && (
                  <p role="alert" className="text-[12px] text-danger md:col-span-2">
                    {createError}
                  </p>
                )}
                <div className="md:col-span-2">
                  <Btn type="submit" variant="primary" disabled={creating}>
                    {creating ? "Saving..." : "Create customer"}
                  </Btn>
                </div>
              </form>
            </Panel>
          )}
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <Panel className="min-w-0">
              <PanelHead title="Customer directory" sub="Customers you have access to" />
              <form onSubmit={search} className="flex flex-wrap gap-2 border-b border-border p-4">
                <label className="min-w-[200px] flex-1 text-[12px] font-medium">
                  <span className="sr-only">Search customer name, code, phone or email</span>
                  <input
                    type="search"
                    value={draftQuery}
                    maxLength={160}
                    onChange={(event) => setDraftQuery(event.target.value)}
                    placeholder="Search name, code, phone or email"
                    className="h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
                  />
                </label>
                <Btn type="submit">Search</Btn>
                <Btn type="button" onClick={() => setRevision((value) => value + 1)}>
                  Refresh
                </Btn>
              </form>
              {!visibleList || visibleList.status === "loading" ? (
                <CrmLoading label="Loading customers" />
              ) : visibleList.status === "error" ? (
                <CrmError
                  message={visibleList.error}
                  retry={() => setRevision((value) => value + 1)}
                />
              ) : visibleList.page?.customers.length ? (
                <>
                  <div className="divide-y divide-border">
                    {visibleList.page.customers.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        aria-pressed={selectedId === row.id}
                        onClick={() => {
                          setSelected({ id: row.id, scope: scopeKey });
                          setNote("");
                          setNoteError("");
                        }}
                        className="w-full p-4 text-left transition-colors hover:bg-secondary/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[13px] font-semibold">{row.displayName}</span>
                          <Status>{readableStatus(row.status)}</Status>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {row.customerCode} · {readableStatus(row.accountType)}
                          {row.phone ? " · " + row.phone : ""}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3 text-[12px]">
                          <span>Orders: {row.orderCount.toLocaleString()}</span>
                          <span>Points: {row.loyaltyPoints.toLocaleString()}</span>
                          {canViewValue && !isAllBranches && row.currency && (
                            <span>Reported spend: {money(row.netSpendMinor, row.currency)}</span>
                          )}
                          <span>Last activity: {shortDate(row.lastActivityAt)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between border-t border-border p-3">
                    <Btn
                      disabled={backStack.length === 0}
                      onClick={() => {
                        const previous = backStack[backStack.length - 1];
                        setBackStack((current) => current.slice(0, -1));
                        setCursor(previous || null);
                      }}
                    >
                      Previous
                    </Btn>
                    <span className="text-[12px] text-muted-foreground">
                      Page {backStack.length + 1}
                    </span>
                    <Btn
                      disabled={!visibleList.page?.nextCursor}
                      onClick={() => {
                        if (!visibleList.page?.nextCursor) return;
                        setBackStack((current) => [...current, cursor ?? ""]);
                        setCursor(visibleList.page.nextCursor ?? null);
                      }}
                    >
                      Next
                    </Btn>
                  </div>
                </>
              ) : (
                <CrmEmpty
                  title="No matching customers"
                  body="Try a different search or create a new customer if you have permission."
                />
              )}
            </Panel>
            <Panel className="min-w-0">
              <PanelHead
                title="Customer profile"
                sub={selectedId ? "Live customer details" : "Select a customer from the directory"}
              />
              {!selectedId ? (
                <CrmEmpty
                  title="Select a customer"
                  body="Customer orders, loyalty, feedback and contact preferences appear here."
                />
              ) : profile.key !== profileKey || profile.status === "loading" ? (
                <CrmLoading label="Loading customer profile" />
              ) : profile.status === "error" ? (
                <CrmError
                  message={profile.error}
                  retry={() => setProfileRevision((value) => value + 1)}
                />
              ) : customer ? (
                <div className="space-y-5 p-4 text-[13px]">
                  <div>
                    <h3 className="text-lg font-semibold">{customer.displayName}</h3>
                    <p className="text-[12px] text-muted-foreground">
                      {customer.customerCode} · {readableStatus(customer.accountType)}
                    </p>
                    {customer.companyName && <p>{customer.companyName}</p>}
                    {customer.phone && <p>Phone: {customer.phone}</p>}
                    {customer.email && <p>Email: {customer.email}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-secondary/60 p-3">
                      <p className="text-[11px] text-muted-foreground">Completed orders</p>
                      <p className="text-lg font-semibold">
                        {customer.orderCount.toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-lg bg-secondary/60 p-3">
                      <p className="text-[11px] text-muted-foreground">Loyalty points</p>
                      <p className="text-lg font-semibold">
                        {customer.loyaltyPoints.toLocaleString()}
                      </p>
                    </div>
                    {canViewValue && !isAllBranches && customer.currency && (
                      <div className="col-span-2 rounded-lg bg-secondary/60 p-3">
                        <p className="text-[11px] text-muted-foreground">Reported net spend</p>
                        <p className="text-lg font-semibold">
                          {money(customer.netSpendMinor, customer.currency)}
                        </p>
                      </div>
                    )}
                  </div>
                  {isAllBranches && (
                    <p className="text-[12px] text-muted-foreground">
                      Cross-branch spend totals are withheld here until their currencies are
                      verified.
                    </p>
                  )}
                  <section>
                    <h4 className="font-semibold">Visit history</h4>
                    <p>Visits: {customer.visits.count.toLocaleString()}</p>
                    <p>Last visit: {shortDate(customer.visits.lastVisitAt)}</p>
                    {customer.visits.favoriteItems.length > 0 && (
                      <p>
                        Frequent items:{" "}
                        {customer.visits.favoriteItems
                          .slice(0, 4)
                          .map((item) => item.name + " (" + item.quantity + ")")
                          .join(", ")}
                      </p>
                    )}
                  </section>
                  <section>
                    <h4 className="font-semibold">Loyalty memberships</h4>
                    {customer.loyalty.length ? (
                      <ul className="mt-2 space-y-2">
                        {customer.loyalty.map((item) => (
                          <li key={item.programId} className="rounded-md border border-border p-2">
                            <p>
                              {item.programName}
                              {item.tierName ? " · " + item.tierName : ""}
                            </p>
                            <p className="text-muted-foreground">
                              Balance: {item.pointsBalance.toLocaleString()} points
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">No memberships recorded.</p>
                    )}
                  </section>
                  <section>
                    <h4 className="font-semibold">Marketing consent</h4>
                    <ul className="mt-2 space-y-1 text-[12px]">
                      {customer.consents.map((item) => (
                        <li key={item.channel} className="flex justify-between gap-2">
                          <span>{readableStatus(item.channel)}</span>
                          <Status>{readableStatus(item.status)}</Status>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h4 className="font-semibold">Service feedback</h4>
                    {customer.feedback.length ? (
                      <ul className="mt-2 space-y-2">
                        {customer.feedback.slice(0, 5).map((item) => (
                          <li key={item.id}>
                            <span>{item.category}</span>
                            <span aria-hidden="true"> · </span>
                            <span>{readableStatus(item.status)}</span>
                            <span aria-hidden="true"> · </span>
                            <span>{shortDate(item.submittedAt)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">No service feedback recorded.</p>
                    )}
                  </section>
                  <section>
                    <h4 className="font-semibold">Customer journey</h4>
                    {customer.journey.length ? (
                      <ol className="mt-2 space-y-2">
                        {customer.journey.slice(0, 8).map((event) => (
                          <li key={event.id}>
                            <p>{event.summary}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {shortDate(event.occurredAt)}
                            </p>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-muted-foreground">No events recorded.</p>
                    )}
                  </section>
                  {canManage && (
                    <section>
                      <h4 className="font-semibold">Internal CRM notes</h4>
                      <ul className="my-2 space-y-2">
                        {customer.notes.map((item) => (
                          <li key={item.id} className="rounded-md bg-secondary/60 p-2">
                            <p className="whitespace-pre-wrap">{item.note}</p>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {shortDate(item.createdAt)}
                            </p>
                          </li>
                        ))}
                      </ul>
                      <form onSubmit={saveNote} className="space-y-2">
                        <label className="grid gap-1 text-[12px] font-medium">
                          Add internal note
                          <textarea
                            maxLength={2000}
                            rows={3}
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            className="w-full rounded-md border border-border bg-background p-2 text-[13px]"
                          />
                        </label>
                        {noteError && (
                          <p role="alert" className="text-danger">
                            {noteError}
                          </p>
                        )}
                        <Btn type="submit" disabled={!note.trim() || savingNote}>
                          {savingNote ? "Saving..." : "Save note"}
                        </Btn>
                      </form>
                    </section>
                  )}
                </div>
              ) : null}
            </Panel>
          </div>
        </>
      )}
    </AppShell>
  );
}
