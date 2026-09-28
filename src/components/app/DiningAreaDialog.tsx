import { useState, type FormEvent } from "react";
import { useAppContext } from "@/lib/app-context";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { permissions } from "@/platform/permissions";
import { Btn } from "@/components/app/ui";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export function DiningAreaDialog({ branchLabel, onCreated }: {
  branchLabel: string;
  onCreated: (name: string) => void;
}) {
  const { hasPermission, refreshAccess } = useAppContext();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!hasPermission(permissions.tableManage)) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await authenticatedFetch("/api/seramet/tables/areas", {
        method: "POST",
        headers: {"content-type":"application/json"},
        body: JSON.stringify({name:name.trim()}),
      });
      const body = (await response.json().catch(() => ({}))) as {
        area?: {id:string;name:string};message?:string;
      };
      if (!response.ok || !body.area) {
        throw new Error(body.message ?? `Unable to create dining area (${response.status})`);
      }
      await refreshAccess();
      onCreated(body.area.name);
      setOpen(false);
      setName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create dining area");
    } finally {
      setBusy(false);
    }
  };

  return <>
    <Btn onClick={() => {setError("");setOpen(true);}}>Add dining area</Btn>
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a dining area</DialogTitle>
          <DialogDescription>Organize tables for {branchLabel}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <label className="block space-y-1 text-[13px] font-semibold">
            <span>Area name</span>
            <input required autoFocus maxLength={80} minLength={2} value={name}
              onChange={(event) => setName(event.target.value)} placeholder="Dining"
              className="h-10 w-full rounded-md border border-border bg-background px-3" />
          </label>
          {error && <p className="text-[12px] text-danger" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Btn type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn type="submit" variant="primary" disabled={busy || name.trim().length < 2}>
              {busy ? "Creating..." : "Create area"}
            </Btn>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
