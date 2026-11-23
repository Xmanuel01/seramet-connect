// KRA eTIMS (OSCU) settings for the current branch: enter the details KRA
// approved, activate the device with KRA, then turn signing on. Receipts are
// signed by KRA before they print only once eTIMS is on.
import { useEffect, useState } from "react";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";

const inputClass =
  "h-10 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary";
const labelClass = "grid min-w-0 gap-1.5 text-[12px] font-semibold text-muted-foreground";

type Settings = {
  configured: boolean;
  activated?: boolean;
  enabled?: boolean;
  environment?: "SANDBOX" | "PRODUCTION";
  tin?: string;
  bhfId?: string;
  deviceSerial?: string;
  itemClassCode?: string;
  untaxedTaxType?: "A" | "C" | "D";
  qrFormat?: "KRA_LINK" | "SCU_DATA";
  sdcId?: string;
  taxpayerName?: string;
  initializedAt?: string;
};

type Draft = {
  environment: "SANDBOX" | "PRODUCTION";
  tin: string;
  bhfId: string;
  deviceSerial: string;
  itemClassCode: string;
  untaxedTaxType: "A" | "C" | "D";
  qrFormat: "KRA_LINK" | "SCU_DATA";
};

const empty: Draft = {
  environment: "SANDBOX",
  tin: "",
  bhfId: "00",
  deviceSerial: "",
  itemClassCode: "",
  untaxedTaxType: "D",
  qrFormat: "KRA_LINK",
};

async function call(method: string, path: string, body?: unknown): Promise<Settings> {
  const response = await authenticatedFetch(`/api/seramet/etims/${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await response.json().catch(() => ({}))) as Settings & {
    error?: string;
    message?: string;
  };
  if (!response.ok)
    throw new Error(json.message ?? json.error ?? `eTIMS request failed (${response.status})`);
  return json;
}

export function EtimsSettingsCard() {
  const [settings, setSettings] = useState<Settings>();
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();

  const load = (next: Settings) => {
    setSettings(next);
    if (next.configured)
      setDraft({
        environment: next.environment ?? "SANDBOX",
        tin: next.tin ?? "",
        bhfId: next.bhfId ?? "00",
        deviceSerial: next.deviceSerial ?? "",
        itemClassCode: next.itemClassCode ?? "",
        untaxedTaxType: next.untaxedTaxType ?? "D",
        qrFormat: next.qrFormat ?? "KRA_LINK",
      });
  };

  useEffect(() => {
    call("GET", "settings")
      .then(load)
      .catch((error: Error) => setMessage({ tone: "error", text: error.message }));
  }, []);

  const run = async (action: () => Promise<Settings>, done: string) => {
    setBusy(true);
    setMessage(undefined);
    try {
      load(await action());
      setMessage({ tone: "ok", text: done });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "eTIMS request failed",
      });
    } finally {
      setBusy(false);
    }
  };

  const save = (enabled: boolean) =>
    run(
      () => call("PUT", "settings", { ...draft, enabled }),
      enabled ? "eTIMS is on. Receipts are signed by KRA before they print." : "Settings saved.",
    );

  const field = (key: keyof Draft, label: string, placeholder?: string) => (
    <label className={labelClass}>
      {label}
      <input
        value={draft[key]}
        placeholder={placeholder}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
        className={inputClass}
      />
    </label>
  );

  const state = !settings?.configured
    ? "Not set up"
    : settings.enabled
      ? "On"
      : settings.activated
        ? "Activated, off"
        : "Not activated";

  return (
    <Panel className="mt-4">
      <PanelHead
        title="KRA eTIMS (OSCU)"
        sub="Receipts signed by KRA before printing"
        right={<Status>{state}</Status>}
      />
      <div className="grid gap-3 p-4 md:grid-cols-2">
        <label className={labelClass}>
          KRA server
          <select
            value={draft.environment}
            onChange={(event) =>
              setDraft({ ...draft, environment: event.target.value as Draft["environment"] })
            }
            className={inputClass}
          >
            <option value="SANDBOX">Sandbox (testing)</option>
            <option value="PRODUCTION">Production (live receipts)</option>
          </select>
        </label>
        {field("tin", "KRA PIN", "P051234567X")}
        {field("bhfId", "Branch ID", "00")}
        {field("deviceSerial", "Device serial number (from KRA)")}
        {field("itemClassCode", "Item classification code (KRA)")}
        <label className={labelClass}>
          Items with no VAT rule are
          <select
            value={draft.untaxedTaxType}
            onChange={(event) =>
              setDraft({ ...draft, untaxedTaxType: event.target.value as Draft["untaxedTaxType"] })
            }
            className={inputClass}
          >
            <option value="D">D - Non-VAT</option>
            <option value="A">A - Exempt</option>
            <option value="C">C - Zero-rated (0%)</option>
          </select>
        </label>
        <label className={labelClass}>
          Receipt QR content
          <select
            value={draft.qrFormat}
            onChange={(event) =>
              setDraft({ ...draft, qrFormat: event.target.value as Draft["qrFormat"] })
            }
            className={inputClass}
          >
            <option value="KRA_LINK">KRA verification link</option>
            <option value="SCU_DATA">SCU data string (TIS 6.23.8)</option>
          </select>
        </label>
        {settings?.activated && (
          <p className="text-[12px] text-muted-foreground md:col-span-2">
            Activated as CU {settings.sdcId}
            {settings.taxpayerName ? ` for ${settings.taxpayerName}` : ""}
            {settings.initializedAt ? ` on ${settings.initializedAt.slice(0, 10)}` : ""}.
          </p>
        )}
        {message && (
          <p
            className={`text-[12px] md:col-span-2 ${message.tone === "error" ? "text-destructive" : "text-foreground"}`}
          >
            {message.text}
          </p>
        )}
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Btn variant="default" disabled={busy} onClick={() => save(false)}>
            Save details
          </Btn>
          <Btn
            variant="default"
            disabled={busy || !settings?.configured}
            onClick={() => run(() => call("POST", "activate"), "OSCU activated with KRA.")}
          >
            Activate with KRA
          </Btn>
          {settings?.enabled ? (
            <Btn variant="default" disabled={busy} onClick={() => save(false)}>
              Turn eTIMS off
            </Btn>
          ) : (
            <Btn
              variant="primary"
              disabled={busy || !settings?.activated}
              onClick={() => save(true)}
            >
              Turn eTIMS on
            </Btn>
          )}
        </div>
      </div>
    </Panel>
  );
}
