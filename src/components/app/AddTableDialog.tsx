import { useState, type FormEvent } from "react";
import { useAppContext } from "@/lib/app-context";
import { getSerametAccessToken } from "@/lib/access-token";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { permissions } from "@/platform/permissions";
import { Btn } from "@/components/app/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type AreaOption = { id: string; name: string };

export function AddTableDialog({
  branchLabel,
  existingCount,
  areas,
  onCreated,
}: {
  branchLabel: string;
  existingCount: number;
  areas: AreaOption[];
  onCreated: (code: string, serviceAreaId: string | null) => void;
}) {
  const { hasPermission, refreshAccess } = useAppContext();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");
  const [seats, setSeats] = useState("4");
  const [areaId, setAreaId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  if (!hasPermission(permissions.tableManage)) return null;

  const begin = () => {
    setCode(`T${String(existingCount + 1).padStart(2, "0")}`);
    setSeats("4");
    setAreaId(areas[0]?.id ?? "");
    setError("");
    setNotice("");
    setOpen(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setError("");
    const token = getSerametAccessToken();
    try {
      const response = await authenticatedFetch("/api/seramet/tables/configuration", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          code: code.trim(),
          seats: Number(seats),
          ...(areaId ? { serviceAreaId: areaId } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        table?: { code: string };
        message?: string;
      };
      if (!response.ok || !body.table) {
        throw new Error(body.message ?? `Unable to create table (${response.status})`);
      }
      setNotice(`Table ${body.table.code} was created.`);
      try {
        await refreshAccess();
        onCreated(body.table.code, areaId || null);
      } catch {
        setNotice(`Table ${body.table.code} was created. Refresh the page to see it.`);
      }
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create table");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Btn variant="primary" onClick={begin}>
        Add table
      </Btn>
      {notice && (
        <span className="text-[11px] text-success" role="status">
          {notice}
        </span>
      )}
      <Dialog open={open} onOpenChange={(next) => !creating && setOpen(next)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add a restaurant table</DialogTitle>
            <DialogDescription>
              Add a table to {branchLabel}. It will appear in Tables and POS.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            <label className="block space-y-1 text-[13px] font-semibold">
              <span>Table number</span>
              <input
                autoFocus
                required
                aria-label="Table number"
                maxLength={16}
                pattern="[a-zA-Z0-9-]+"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="T01"
                className="h-10 w-full rounded-md border border-border bg-background px-3"
              />
            </label>
            <label className="block space-y-1 text-[13px] font-semibold">
              <span>Seats</span>
              <input
                required
                aria-label="Seats"
                type="number"
                min={1}
                max={30}
                step={1}
                value={seats}
                onChange={(event) => setSeats(event.target.value)}
                className="h-10 w-full rounded-md border border-border bg-background px-3"
              />
            </label>
            {areas.length > 0 && (
              <label className="block space-y-1 text-[13px] font-semibold">
                <span>Dining area (optional)</span>
                <select
                  value={areaId}
                  onChange={(event) => setAreaId(event.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3"
                >
                  <option value="">Unassigned</option>
                  {areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {error && (
              <p className="text-[12px] text-danger" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Btn type="button" disabled={creating} onClick={() => setOpen(false)}>
                Cancel
              </Btn>
              <Btn type="submit" variant="primary" disabled={creating || !code.trim() || !seats}>
                {creating ? "Creating..." : "Create table"}
              </Btn>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
