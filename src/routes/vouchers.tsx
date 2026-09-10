import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import {
  CrmEmpty,
  CrmError,
  CrmLoading,
  minorToMajor,
  readableStatus,
  shortDate,
} from "@/crm/crm-ui";
import { useCrmApi, useCrmQuery } from "@/crm/use-crm";
import { ksh } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/vouchers")({
  head: () => ({ meta: [{ title: "Vouchers - Seramet" }] }),
  component: Vouchers,
});

type VoucherRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  valid_from: string;
  valid_to?: string;
  discount_type: string;
  discount_value: number;
  usage_cap?: number;
  per_customer_cap?: number;
  stacking_policy: string;
  customer_specific: number;
  issued: number;
  redeemed: number;
};

function Vouchers() {
  const { activeTenantId, branchId, branchLabel, isAllBranches, platformState } = useAppContext();
  const currency = platformState.tenants.find(
    (tenant) => tenant.id === activeTenantId,
  )?.defaultCurrency;
  const { command } = useCrmApi();
  const vouchers = useCrmQuery<{ vouchers: VoucherRow[] }>("/api/seramet/crm/vouchers");
  const [createOpen, setCreateOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueVoucherId, setIssueVoucherId] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    discountType: "FIXED_MINOR",
    discountValue: "500",
    minimumSpend: "0",
    usageCap: "",
    perCustomerCap: "1",
    validTo: "",
    stackingPolicy: "BLOCK",
    customerSpecific: false,
  });
  const rows = vouchers.data?.vouchers ?? [];
  const redeemed = rows.reduce((sum, row) => sum + Number(row.redeemed ?? 0), 0);

  const createVoucher = async () => {
    const rawValue = Number(form.discountValue);
    if (!form.code.trim() || !form.name.trim() || !Number.isFinite(rawValue) || rawValue < 0)
      return;
    setBusy(true);
    try {
      await command("/api/seramet/crm/vouchers", {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        validFrom: new Date().toISOString(),
        ...(form.validTo
          ? { validTo: new Date(`${form.validTo}T23:59:59.999Z`).toISOString() }
          : {}),
        branchIds: isAllBranches ? [] : [branchId],
        channels: [],
        itemIds: [],
        categoryCodes: [],
        minimumSpendMinor: Math.round(Number(form.minimumSpend || 0) * 100),
        ...(currency ? { currency } : {}),
        discountType: form.discountType,
        discountValue:
          form.discountType === "FIXED_MINOR"
            ? Math.round(rawValue * 100)
            : Math.round(rawValue * 100),
        ...(form.usageCap ? { usageCap: Math.round(Number(form.usageCap)) } : {}),
        ...(form.perCustomerCap ? { perCustomerCap: Math.round(Number(form.perCustomerCap)) } : {}),
        customerSpecific: form.customerSpecific,
        singleUse: form.customerSpecific,
        stackingPolicy: form.stackingPolicy,
        stackingPriority: 100,
        refundPolicy: "KEEP_REDEMPTION",
      });
      setCreateOpen(false);
      setNotice(
        "Voucher definition created. Checkout will recalculate all eligibility and limits on the server.",
      );
      await vouchers.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Voucher could not be created");
    } finally {
      setBusy(false);
    }
  };

  const issueVoucher = async () => {
    if (!issueVoucherId) return;
    setBusy(true);
    try {
      const response = await command<{ issue: { code: string; codeLastFour: string } }>(
        "/api/seramet/crm/vouchers/issue",
        { voucherDefinitionId: issueVoucherId, sourceType: "OPERATOR_ISSUE" },
      );
      setNotice(
        `Voucher issued. Secure code: ${response.issue.code}. This is the only time the full code is shown.`,
      );
      setIssueOpen(false);
      await vouchers.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Voucher could not be issued");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Vouchers"
      subtitle={`Promotional value with server-enforced scope, caps and replay protection - ${branchLabel}`}
      actions={
        <>
          <Btn onClick={() => setIssueOpen(true)}>Issue voucher</Btn>
          <Btn variant="primary" onClick={() => setCreateOpen(true)}>
            New voucher
          </Btn>
        </>
      }
    >
      {notice && (
        <div className="mb-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] font-medium break-all">
          {notice}
        </div>
      )}
      {vouchers.status === "loading" && !vouchers.data ? (
        <CrmLoading />
      ) : vouchers.status === "error" ? (
        <Panel>
          <CrmError message={vouchers.error} retry={() => void vouchers.refresh()} />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Definitions" value={rows.length} />
            <Metric label="Active" value={rows.filter((row) => row.status === "ACTIVE").length} />
            <Metric
              label="Issued"
              value={rows.reduce((sum, row) => sum + Number(row.issued ?? 0), 0)}
            />
            <Metric label="Redeemed" value={redeemed} />
          </div>
          <Panel className="mt-4">
            <PanelHead
              title="Voucher register"
              sub="Vouchers reduce sale value; they are not stored cash or gift-card liability"
            />
            {!rows.length ? (
              <CrmEmpty
                title="No vouchers"
                body="Create a promotion with explicit branch, cap and stacking rules."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <TH>Voucher</TH>
                      <TH>Value</TH>
                      <TH>Validity</TH>
                      <TH>Caps</TH>
                      <TH>Stacking</TH>
                      <TH className="text-right">Usage</TH>
                      <TH>Status</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((voucher) => (
                      <tr key={voucher.id}>
                        <TD>
                          <div className="font-semibold">{voucher.name}</div>
                          <div className="num text-[11px] text-muted-foreground">
                            {voucher.code}
                          </div>
                        </TD>
                        <TD>
                          {voucher.discount_type === "FIXED_MINOR"
                            ? ksh(minorToMajor(voucher.discount_value))
                            : voucher.discount_type === "PERCENT_BPS"
                              ? `${(voucher.discount_value / 100).toFixed(1)}%`
                              : readableStatus(voucher.discount_type)}
                        </TD>
                        <TD>
                          <div>{shortDate(voucher.valid_from)}</div>
                          <div className="text-[11px] text-muted-foreground">
                            to {shortDate(voucher.valid_to)}
                          </div>
                        </TD>
                        <TD>
                          <div className="text-[12px]">
                            Global {voucher.usage_cap ?? "unlimited"}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            Per customer {voucher.per_customer_cap ?? "unlimited"}
                          </div>
                        </TD>
                        <TD>{readableStatus(voucher.stacking_policy)}</TD>
                        <TD className="num text-right">
                          {voucher.redeemed}/{voucher.issued}
                        </TD>
                        <TD>
                          <Status>{readableStatus(voucher.status)}</Status>
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
        <DialogContent className="max-w-[620px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>New voucher definition</DialogTitle>
            <DialogDescription>
              Configure scope and limits. The server remains authoritative at checkout.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Name"
                value={form.name}
                onChange={(value) => setForm((current) => ({ ...current, name: value }))}
              />
              <Input
                label="Public code"
                value={form.code}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    code: value.replace(/[^a-z0-9_-]/gi, "").toUpperCase(),
                  }))
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Discount"
                value={form.discountType}
                onChange={(value) => setForm((current) => ({ ...current, discountType: value }))}
                options={[
                  { value: "FIXED_MINOR", label: "Fixed amount" },
                  { value: "PERCENT_BPS", label: "Percentage" },
                  { value: "NON_FINANCIAL", label: "Non-financial" },
                ]}
              />
              <Input
                label={form.discountType === "PERCENT_BPS" ? "Percentage" : "Amount"}
                value={form.discountValue}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    discountValue: value.replace(/[^0-9.]/g, ""),
                  }))
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="Minimum spend"
                value={form.minimumSpend}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    minimumSpend: value.replace(/[^0-9.]/g, ""),
                  }))
                }
              />
              <Input
                label="Global usage cap"
                value={form.usageCap}
                onChange={(value) =>
                  setForm((current) => ({ ...current, usageCap: value.replace(/\D/g, "") }))
                }
              />
              <Input
                label="Per-customer cap"
                value={form.perCustomerCap}
                onChange={(value) =>
                  setForm((current) => ({ ...current, perCustomerCap: value.replace(/\D/g, "") }))
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Stacking"
                value={form.stackingPolicy}
                onChange={(value) => setForm((current) => ({ ...current, stackingPolicy: value }))}
                options={["BLOCK", "ALLOW", "BEST_ONLY", "PRIORITY_ORDER"].map((value) => ({
                  value,
                  label: readableStatus(value),
                }))}
              />
              <Input
                label="Valid until"
                type="date"
                value={form.validTo}
                onChange={(value) => setForm((current) => ({ ...current, validTo: value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-[12px] font-semibold">
              <input
                type="checkbox"
                checked={form.customerSpecific}
                onChange={(event) =>
                  setForm((current) => ({ ...current, customerSpecific: event.target.checked }))
                }
              />
              Customer-specific, strong single-use code
            </label>
            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Btn onClick={() => setCreateOpen(false)}>Cancel</Btn>
              <Btn variant="primary" disabled={busy} onClick={() => void createVoucher()}>
                {busy ? "Creating..." : "Create voucher"}
              </Btn>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent className="max-w-[480px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>Issue voucher</DialogTitle>
            <DialogDescription>
              A cryptographically strong code is generated and shown once.
            </DialogDescription>
          </DialogHeader>
          <Select
            label="Voucher definition"
            value={issueVoucherId}
            onChange={setIssueVoucherId}
            options={[
              { value: "", label: "Select voucher" },
              ...rows
                .filter((row) => row.status === "ACTIVE")
                .map((row) => ({ value: row.id, label: row.name })),
            ]}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Btn onClick={() => setIssueOpen(false)}>Cancel</Btn>
            <Btn
              variant="primary"
              disabled={busy || !issueVoucherId}
              onClick={() => void issueVoucher()}
            >
              {busy ? "Issuing..." : "Issue secure code"}
            </Btn>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value.slice(0, 160))}
        className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary"
      />
    </label>
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
