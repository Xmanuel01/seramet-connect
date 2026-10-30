import { useState, type FormEvent } from "react";
import { CheckCircle2, AlertTriangle, Smartphone } from "lucide-react";
import { Btn, Panel, PanelHead } from "@/components/app/ui";
import type { useSetupCentre } from "@/onboarding/use-setup-centre";

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground outline-none focus:border-primary";
const labelClass = "grid gap-1 text-[12px] font-semibold text-muted-foreground";

type Centre = ReturnType<typeof useSetupCentre>;
type AccountType = "TILL" | "PAYBILL";

/**
 * Connects a restaurant's own M-Pesa till or Paybill. Daraja keys are sent once, stored encrypted
 * on the server and never shown again; leaving a key blank keeps the one already saved.
 */
export function MpesaConnect({ centre }: { centre: Centre }) {
  const branches = centre.structure.branches;
  const [accountType, setAccountType] = useState<AccountType>("TILL");
  const [branchId, setBranchId] = useState(branches.length === 1 ? (branches[0]?.id ?? "") : "");
  const [environment, setEnvironment] = useState<"SANDBOX" | "PRODUCTION">("PRODUCTION");
  const [shortcode, setShortcode] = useState("");
  const [tillNumber, setTillNumber] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [keys, setKeys] = useState({ consumerKey: "", consumerSecret: "", passkey: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const existing = centre.integrations.find(
    (item) => item.providerId === "provider-daraja" && (item.branchId ?? "") === branchId,
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const credentials = Object.fromEntries(
        Object.entries(keys).filter(([, value]) => value.trim()),
      );
      await centre.command("/api/seramet/setup/provider-connections", {
        providerId: "provider-daraja",
        ...(branchId ? { branchId } : {}),
        environment,
        configuration: {
          accountType,
          shortcode: shortcode.trim(),
          ...(accountType === "TILL" ? { tillNumber: tillNumber.trim() } : {}),
          ...(businessName.trim() ? { qrMerchantName: businessName.trim() } : {}),
        },
        ...(Object.keys(credentials).length ? { credentials } : {}),
        enabled: true,
      });
      setKeys({ consumerKey: "", consumerSecret: "", passkey: "" });
      setNotice({
        kind: "success",
        message:
          "M-Pesa saved. Your keys are stored encrypted and will not be shown again. Next, turn on payment notifications.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "M-Pesa could not be saved",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <PanelHead
        title="Connect M-Pesa"
        sub="Customers pay your own till or Paybill; Seramet records each payment"
        right={<Smartphone className="h-4 w-4 text-primary" />}
      />
      <form onSubmit={(event) => void submit(event)} className="space-y-3 p-4">
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="mb-1 text-[12px] font-semibold text-muted-foreground">
            How do customers pay you?
          </legend>
          {(
            [
              ["TILL", "Till number", "Lipa na M-Pesa Buy Goods"],
              ["PAYBILL", "Paybill", "Business number and account"],
            ] as const
          ).map(([value, title, detail]) => (
            <label
              key={value}
              className={`cursor-pointer rounded-md border p-2.5 text-[12px] ${
                accountType === value ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="mpesa-account-type"
                className="sr-only"
                checked={accountType === value}
                onChange={() => setAccountType(value)}
              />
              <span className="block font-semibold text-foreground">{title}</span>
              <span className="text-muted-foreground">{detail}</span>
            </label>
          ))}
        </fieldset>
        {accountType === "TILL" ? (
          <div className="grid grid-cols-2 gap-2">
            <label className={labelClass}>
              Till number
              <input
                required
                inputMode="numeric"
                value={tillNumber}
                onChange={(event) => setTillNumber(event.target.value)}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Store number
              <input
                required
                inputMode="numeric"
                value={shortcode}
                onChange={(event) => setShortcode(event.target.value)}
                className={inputClass}
              />
            </label>
            <p className="col-span-2 text-[11px] text-muted-foreground">
              The store (head office) number is on your Lipa na M-Pesa registration and in the
              M-Pesa business portal. It is often different from the till number.
            </p>
          </div>
        ) : (
          <label className={labelClass}>
            Paybill number
            <input
              required
              inputMode="numeric"
              value={shortcode}
              onChange={(event) => setShortcode(event.target.value)}
              className={inputClass}
            />
          </label>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className={labelClass}>
            Branch
            <select
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
              className={inputClass}
            >
              <option value="">All branches</option>
              {branches.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Mode
            <select
              value={environment}
              onChange={(event) => setEnvironment(event.target.value as "SANDBOX" | "PRODUCTION")}
              className={inputClass}
            >
              <option value="PRODUCTION">Live payments</option>
              <option value="SANDBOX">Safaricom sandbox (testing)</option>
            </select>
          </label>
        </div>
        <label className={labelClass}>
          Business name on QR codes (optional)
          <input
            value={businessName}
            onChange={(event) => setBusinessName(event.target.value)}
            className={inputClass}
          />
        </label>
        <div className="space-y-2 rounded-md border border-border bg-secondary/30 p-3">
          <p className="text-[12px] font-semibold text-foreground">Daraja app keys</p>
          <p className="text-[11px] text-muted-foreground">
            From your app on developer.safaricom.co.ke after going live.
            {existing ? " Leave blank to keep the keys already saved." : ""}
          </p>
          {(
            [
              ["consumerKey", "Consumer key"],
              ["consumerSecret", "Consumer secret"],
              ["passkey", "Passkey"],
            ] as const
          ).map(([key, label]) => (
            <label className={labelClass} key={key}>
              {label}
              <input
                type="password"
                autoComplete="off"
                required={!existing}
                placeholder={existing ? "Saved" : ""}
                value={keys[key]}
                onChange={(event) => setKeys({ ...keys, [key]: event.target.value })}
                className={inputClass}
              />
            </label>
          ))}
        </div>
        {notice && (
          <p
            role="status"
            className={`flex items-start gap-2 text-[12px] ${
              notice.kind === "error" ? "text-danger" : "text-success"
            }`}
          >
            {notice.kind === "error" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            {notice.message}
          </p>
        )}
        <Btn type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy ? "Saving…" : existing ? "Update M-Pesa" : "Connect M-Pesa"}
        </Btn>
      </form>
    </Panel>
  );
}

/** Registers the till or Paybill with Safaricom so payments made without a prompt reach Seramet. */
export function MpesaNotificationsButton({
  centre,
  connectionId,
}: {
  centre: Centre;
  connectionId: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const register = async () => {
    setState("busy");
    try {
      await centre.command(
        `/api/seramet/integrations/connections/${encodeURIComponent(connectionId)}/payment-notifications`,
        {},
      );
      setState("done");
      setMessage("Payment notifications are on");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Could not turn on notifications");
    }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <Btn disabled={state === "busy"} onClick={() => void register()}>
        {state === "busy" ? "Turning on…" : "Turn on notifications"}
      </Btn>
      {message && (
        <span
          role="status"
          className={`text-[11px] ${state === "error" ? "text-danger" : "text-success"}`}
        >
          {message}
        </span>
      )}
    </div>
  );
}
