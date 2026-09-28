import { useEffect, useRef, useState, type FormEvent } from "react";
import { customerSearchPath } from "@/crm/customer-360-model";
import type { PosCustomerIdentity } from "@/crm/pos-customer-link";
import type { CustomerSummary } from "@/crm/types";
import { useCrmApi } from "@/crm/use-crm";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";

type SearchResponse = {
  ok: boolean;
  customers: CustomerSummary[];
};

export function PosCustomerPicker({
  value,
  disabled,
  onSelect,
  compact = false,
}: {
  value: PosCustomerIdentity | null;
  disabled: boolean;
  onSelect: (value: PosCustomerIdentity | null) => void;
  compact?: boolean;
}) {
  const { activeTenantId, branchId, hasPermission } = useAppContext();
  const { request } = useCrmApi();
  const canSearch = hasPermission(permissions.crmCustomerView);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerSummary[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState("");
  const [searchRevision, setSearchRevision] = useState(0);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const lookupRef = useRef<AbortController | null>(null);

  const scope = activeTenantId + ":" + branchId;
  const [resultScope, setResultScope] = useState(scope);
  const visibleResults = resultScope === scope ? results : [];

  useEffect(() => {
    if (disabled || !canSearch || !open || !submitted) return;
    const controller = new AbortController();
    lookupRef.current?.abort();
    lookupRef.current = controller;
    setStatus("loading");
    setMessage("");
    setResults([]);
    setResultScope(scope);
    void request<SearchResponse>(
      customerSearchPath({
        query: submitted,
        branchId,
        isAllBranches: false,
        limit: 10,
      }),
      { signal: controller.signal },
    )
      .then((response) => {
        if (controller.signal.aborted) return;
        setResults(response.customers);
        setStatus("ready");
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setStatus("error");
        setMessage(cause instanceof Error ? cause.message : "Customer lookup failed");
      });
    return () => controller.abort();
  }, [branchId, canSearch, disabled, open, request, scope, searchRevision, submitted]);

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const term = query.trim();
    if (!term) return;
    setSubmitted(term);
    setSearchRevision((value) => value + 1);
  };

  return (
    <div
      className={
        compact
          ? "relative text-[12px]"
          : "mb-3 rounded-lg border border-border bg-card p-3 text-[12px]"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!compact && (
          <div>
            <span className="font-semibold">Customer account</span>
            <p className="mt-0.5 text-muted-foreground">
              {value ? value.displayName + " · " + value.customerCode : "Unlinked walk-in"}
            </p>
          </div>
        )}
        {compact && value && (
          <span className="max-w-36 truncate font-semibold">{value.displayName}</span>
        )}
        <div className="flex gap-2">
          {value && (
            <button
              type="button"
              disabled={disabled || !canSearch}
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
              className="rounded-md border border-border px-3 py-1.5 font-semibold disabled:opacity-50"
            >
              Unlink
            </button>
          )}
          <button
            type="button"
            disabled={disabled || !canSearch}
            onClick={() => setOpen((current) => !current)}
            className="rounded-md border border-border px-3 py-1.5 font-semibold disabled:opacity-50"
          >
            {open ? "Close lookup" : "Find customer"}
          </button>
        </div>
      </div>
      {!compact && !canSearch && (
        <p className="mt-2 text-muted-foreground">
          Customer lookup requires crm.customer.view permission for this role.
        </p>
      )}
      {!compact && disabled && (
        <p className="mt-2 text-muted-foreground">
          Customer changes are unavailable while disconnected or after billing begins.
        </p>
      )}
      {canSearch && !disabled && open && (
        <div
          className={
            compact
              ? "absolute right-0 top-10 z-40 w-[min(22rem,85vw)] rounded-lg border border-border bg-card p-3 shadow-xl"
              : "mt-3 border-t border-border pt-3"
          }
        >
          <form onSubmit={search} className="flex gap-2">
            <input
              type="search"
              aria-label="Find an existing customer"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={160}
              placeholder="Name, code or phone"
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2"
            />
            <button
              type="submit"
              disabled={!query.trim() || status === "loading"}
              className="rounded-md bg-primary px-3 font-semibold text-primary-foreground disabled:opacity-50"
            >
              Search
            </button>
          </form>
          {status === "loading" && <p className="mt-2">Searching...</p>}
          {status === "error" && (
            <p role="alert" className="mt-2 text-danger">
              {message}
            </p>
          )}
          {status === "ready" && visibleResults.length === 0 && (
            <p className="mt-2 text-muted-foreground">No matching customer accounts.</p>
          )}
          {visibleResults.length > 0 && (
            <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto">
              {visibleResults.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    className="w-full rounded-md border border-border px-3 py-2 text-left hover:bg-secondary"
                    onClick={() => {
                      onSelect({
                        id: customer.id,
                        customerCode: customer.customerCode,
                        displayName: customer.displayName,
                      });
                      setOpen(false);
                      setQuery("");
                      setResults([]);
                      setSubmitted(null);
                      setStatus("idle");
                    }}
                  >
                    <span className="font-semibold">{customer.displayName}</span>
                    <span className="ml-2 text-muted-foreground">{customer.customerCode}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
