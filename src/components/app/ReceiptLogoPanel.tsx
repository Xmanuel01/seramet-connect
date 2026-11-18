import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { ImageIcon, Save, Trash2, Upload } from "lucide-react";
import { useAppContext } from "@/lib/app-context";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { getSerametAccessToken } from "@/lib/access-token";
import { permissions } from "@/platform/permissions";
import { latestPrintBridgeVersion } from "@/lib/print-bridge-client-config";
import {
  printableLogoToDataUrl,
  processReceiptLogoFile,
  toPrintableLogo,
  type PrintableReceiptLogo,
  type ReceiptLogoAsset,
} from "@/lib/receipt-logo";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";

type Scope = "COMPANY" | "BRANCH";
type SavedLogo = PrintableReceiptLogo & { updatedAt: string };
type SavedLogos = { company?: SavedLogo; branch?: SavedLogo };

/**
 * The logo printed at the top of bills, receipts and invoices. A branch logo,
 * when set, replaces the company logo for that branch.
 */
export function ReceiptLogoPanel({ businessName }: { businessName: string }) {
  const { activeTenantId, branch, branchId, hasPermission } = useAppContext();
  const mayManage = hasPermission(permissions.settingsHardwareManage);
  const mayManageCompany = mayManage && hasPermission(permissions.settingsOrganisationManage);
  const [saved, setSaved] = useState<SavedLogos>({});
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<{ scope: Scope; asset: ReceiptLogoAsset } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "x-seramet-branch-id": branchId,
      "x-seramet-tenant-id": activeTenantId,
      ...(getSerametAccessToken() ? { Authorization: `Bearer ${getSerametAccessToken()}` } : {}),
    }),
    [activeTenantId, branchId],
  );
  const call = useCallback(
    async (method: "GET" | "PUT" | "DELETE", body?: unknown, query = "") => {
      const response = await authenticatedFetch(`/api/seramet/printing/receipt-logo${query}`, {
        method,
        headers: headers(),
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      });
      const result = (await response.json().catch(() => ({}))) as SavedLogos & {
        message?: string;
      };
      if (!response.ok) throw new Error(result.message || "Couldn't update the logo. Try again.");
      return { company: result.company, branch: result.branch } as SavedLogos;
    },
    [headers],
  );
  useEffect(() => {
    let current = true;
    setLoaded(false);
    setDraft(null);
    void call("GET")
      .then((logos) => current && setSaved(logos))
      .catch(() => current && setNotice("Couldn't load the saved logo."))
      .finally(() => current && setLoaded(true));
    return () => {
      current = false;
    };
  }, [call]);

  const inUse = saved.branch ?? saved.company;
  const inUseLabel = saved.branch ? `${branch} logo` : saved.company ? "Company logo" : "No logo";
  const inUseImage = useMemo(() => (inUse ? printableLogoToDataUrl(inUse) : ""), [inUse]);

  const choose = async (event: ChangeEvent<HTMLInputElement>, scope: Scope) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const asset = await processReceiptLogoFile(
        file,
        scope === "BRANCH" ? "Branch" : "Company",
        scope === "BRANCH" ? branch : undefined,
        150,
        businessName,
      );
      setDraft({ scope, asset });
      setNotice("");
    } catch {
      setNotice("Couldn't read this image. Try a PNG or JPG.");
    }
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      setSaved(await call("PUT", { scope: draft.scope, logo: toPrintableLogo(draft.asset) }));
      setNotice(
        draft.scope === "BRANCH"
          ? `Saved. ${branch} now prints this logo. Print a test receipt to check it.`
          : "Saved. Branches without their own logo now print this one. Print a test receipt to check it.",
      );
      setDraft(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't save the logo.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (scope: Scope) => {
    setBusy(true);
    try {
      setSaved(await call("DELETE", undefined, `?scope=${scope}`));
      setNotice(scope === "BRANCH" ? `${branch} logo removed.` : "Company logo removed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't remove the logo.");
    } finally {
      setBusy(false);
    }
  };

  const picker = (scope: Scope, label: string) => (
    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-secondary/30 px-4 py-4 text-[13px] font-semibold hover:bg-secondary">
      <Upload className="h-4 w-4 text-primary" />
      {label}
      <input
        type="file"
        accept="image/*"
        onChange={(event) => void choose(event, scope)}
        className="hidden"
        disabled={busy}
      />
    </label>
  );

  return (
    <Panel className="mb-4">
      <PanelHead
        title="Receipt logo"
        sub="Prints at the top of bills, receipts and invoices. A branch logo replaces the company logo in that branch."
        right={<ImageIcon className="h-4 w-4 text-primary" />}
      />
      <div className="grid gap-4 p-4 text-[13px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">Printing now in {branch}</span>
            <Status>{loaded ? inUseLabel : "Loading"}</Status>
          </div>
          {inUse ? (
            <img
              src={inUseImage}
              alt={`${inUseLabel} as it prints`}
              className="h-32 w-full rounded-md border border-border bg-white object-contain p-3 [image-rendering:pixelated]"
            />
          ) : (
            <p className="rounded-md border border-dashed border-border p-4 text-muted-foreground">
              No logo yet. Receipts print your business name, {businessName}, at the top.
            </p>
          )}
          {mayManage && (
            <div className="flex flex-wrap gap-2">
              {saved.branch && (
                <Btn disabled={busy} onClick={() => void remove("BRANCH")}>
                  <Trash2 className="h-4 w-4" />
                  Remove {branch} logo
                </Btn>
              )}
              {saved.company && mayManageCompany && (
                <Btn disabled={busy} onClick={() => void remove("COMPANY")}>
                  <Trash2 className="h-4 w-4" />
                  Remove company logo
                </Btn>
              )}
            </div>
          )}
          <p className="text-[12px] text-muted-foreground">
            Each till PC needs Seramet Print Bridge {latestPrintBridgeVersion} or newer to print the
            logo. If Your printers shows an Update button, use it first. Older bridges print
            receipts without the logo.
          </p>
        </div>
        {mayManage ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {mayManageCompany && picker("COMPANY", "Choose company logo")}
              {picker("BRANCH", `Choose ${branch} logo`)}
            </div>
            {draft && (
              <div className="space-y-3 rounded-lg border border-border bg-secondary/30 p-3">
                <div className="font-semibold">
                  {draft.scope === "BRANCH" ? `New ${branch} logo` : "New company logo"}: how it
                  will print
                </div>
                <img
                  src={draft.asset.monochromeDataUrl}
                  alt="New logo in black and white"
                  className="h-32 w-full rounded-md border border-border bg-white object-contain p-3 [image-rendering:pixelated]"
                />
                <p className="text-[12px] text-muted-foreground">
                  Thermal printers print black only. Simple, high-contrast logos print best.
                </p>
                <div className="flex gap-2">
                  <Btn variant="primary" disabled={busy} onClick={() => void save()}>
                    <Save className="h-4 w-4" />
                    {busy ? "Saving..." : "Save logo"}
                  </Btn>
                  <Btn disabled={busy} onClick={() => setDraft(null)}>
                    Cancel
                  </Btn>
                </div>
              </div>
            )}
            {notice && <p className="text-[12px]">{notice}</p>}
          </div>
        ) : (
          <p className="text-muted-foreground">Ask a manager to change the receipt logo.</p>
        )}
      </div>
    </Panel>
  );
}
