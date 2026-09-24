import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { ClipboardCheck, Plus, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type ProcurementBranchPayload,
  type ProcurementRequisitionRow,
  useProcurementControlCentre,
} from "@/procurement/use-procurement-control-centre";
import { useAppContext } from "@/lib/app-context";
import { formatDate } from "@/lib/currency";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/requisitions")({
  head: () => ({
    meta: [
      { title: "Requisitions - Seramet" },
      {
        name: "description",
        content: "Authoritative purchase requisitions, approvals and PO readiness.",
      },
    ],
  }),
  component: Requisitions,
});

type DisplayRequisition = ProcurementRequisitionRow & { branchId: string };

function Requisitions() {
  const { branchId, branchLabel, currentUser, isAllBranches } = useAppContext();
  const control = useProcurementControlCentre(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");

  const rows = useMemo<DisplayRequisition[]>(
    () =>
      control.data.flatMap((branch) =>
        branch.requisitions.map((row) => ({ ...row, branchId: branch.branchId })),
      ),
    [control.data],
  );
  const open = rows.filter((row) =>
    ["SUBMITTED", "APPROVED", "PARTIALLY_ORDERED"].includes(row.status),
  );
  const awaitingApproval = rows.filter((row) => row.status === "SUBMITTED");
  const readyToOrder = rows.filter((row) =>
    ["APPROVED", "PARTIALLY_ORDERED"].includes(row.status),
  );
  const ordered = rows.filter((row) => row.status === "ORDERED");
  const activeBranchData =
    control.data.find((row) => row.branchId === branchId) ?? control.data[0];

  const canCreate = currentUser.permissions.includes(permissions.procurementRequisitionCreate);
  const canApprove = currentUser.permissions.includes(permissions.procurementRequisitionApprove);

  const approve = async (row: DisplayRequisition) => {
    setBusyId(row.id);
    setNotice("");
    try {
      await control.command(
        `/api/seramet/procurement/requisitions/${encodeURIComponent(row.id)}/approve`,
        { reason: "Approved from requisition register" },
      );
      setNotice(`${row.requisition_number} approved and ready for PO creation.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Requisition approval failed");
    } finally {
      setBusyId("");
    }
  };

  return (
    <AppShell
      title="Requisitions"
      subtitle={`Internal purchase requests before PO creation - ${branchLabel}`}
      actions={
        <>
          <Btn onClick={() => void control.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Btn
            variant="primary"
            disabled={!canCreate || isAllBranches || control.status !== "ready"}
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" /> New requisition
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Open" value={open.length} />
        <Metric label="Awaiting approval" value={awaitingApproval.length} invert={awaitingApproval.length > 0} />
        <Metric label="Approved to order" value={readyToOrder.length} />
        <Metric label="Ordered" value={ordered.length} />
      </div>

      {(notice || control.error || isAllBranches) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error || "Switch to a single branch to create a requisition."}
        </div>
      )}

      <Panel className="mt-4">
        <PanelHead
          title="Requisition queue"
          sub="Submitted requests stay separate from purchase orders until approved"
        />
        {control.status === "loading" ? (
          <div className="p-6 text-[13px] text-muted-foreground">Loading requisitions...</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            No requisitions have been submitted for the selected branch scope.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead>
                <tr>
                  <TH>Requisition</TH>
                  <TH>Source</TH>
                  <TH>Items</TH>
                  <TH>Required</TH>
                  <TH>Created</TH>
                  <TH>Status</TH>
                  <TH>Action</TH>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.branchId}:${row.id}`} className="hover:bg-secondary/50">
                    <TD>
                      <div className="num font-semibold">{row.requisition_number}</div>
                      {isAllBranches && (
                        <div className="text-[11px] text-muted-foreground">{row.branchId}</div>
                      )}
                    </TD>
                    <TD>{row.source_type.replaceAll("_", " ")}</TD>
                    <TD>
                      <div className="space-y-1">
                        {row.lines.slice(0, 3).map((line) => (
                          <div key={line.id} className="text-[12px]">
                            <span className="font-semibold">{line.item_name}</span>{" "}
                            <span className="num text-muted-foreground">
                              {(Number(line.requested_quantity_minor) / 1_000_000).toLocaleString()}{" "}
                              {line.unit_symbol ?? "unit"}
                            </span>
                          </div>
                        ))}
                        {row.lines.length > 3 && (
                          <div className="text-[11px] text-muted-foreground">
                            +{row.lines.length - 3} more
                          </div>
                        )}
                      </div>
                    </TD>
                    <TD className="text-muted-foreground">
                      {row.required_at ? formatDate(row.required_at) : "Not specified"}
                    </TD>
                    <TD className="text-muted-foreground">{formatDate(row.created_at)}</TD>
                    <TD>
                      <Status>{row.status}</Status>
                    </TD>
                    <TD>
                      {row.status === "SUBMITTED" ? (
                        <Btn
                          variant="primary"
                          disabled={!canApprove || busyId === row.id}
                          onClick={() => void approve(row)}
                        >
                          <ClipboardCheck className="h-4 w-4" /> Approve
                        </Btn>
                      ) : ["APPROVED", "PARTIALLY_ORDERED"].includes(row.status) ? (
                        <span className="text-[12px] font-semibold text-success">Ready for PO</span>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">No action</span>
                      )}
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <CreateRequisitionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        branchId={branchId}
        data={activeBranchData}
        busy={Boolean(busyId)}
        onSubmit={async (body) => {
          setBusyId("create");
          setNotice("");
          try {
            await control.command("/api/seramet/procurement/requisitions", body);
            setNotice("Purchase requisition submitted for approval.");
            setCreateOpen(false);
          } catch (error) {
            setNotice(error instanceof Error ? error.message : "Requisition creation failed");
          } finally {
            setBusyId("");
          }
        }}
      />
    </AppShell>
  );
}

function CreateRequisitionDialog({
  open,
  onOpenChange,
  branchId,
  data,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  data: ProcurementBranchPayload | undefined;
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [warehouseId, setWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [sourceType, setSourceType] = useState<"MANUAL_REQUEST" | "LOW_STOCK" | "FORECAST">(
    "MANUAL_REQUEST",
  );
  const [requiredAt, setRequiredAt] = useState("");

  const warehouse =
    data?.warehouses.find((row) => row.id === warehouseId) ?? data?.warehouses[0];
  const item = data?.items.find((row) => row.id === itemId) ?? data?.items[0];
  const unitId = item?.purchase_unit_id ?? item?.base_unit_id;
  const valid = Boolean(warehouse && item && unitId && Number(quantity) > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New purchase requisition</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Source">
            <select
              value={sourceType}
              onChange={(event) => setSourceType(event.target.value as typeof sourceType)}
              className={inputClass}
            >
              <option value="MANUAL_REQUEST">Manual request</option>
              <option value="LOW_STOCK">Low stock</option>
              <option value="FORECAST">Forecast</option>
            </select>
          </Field>
          <Field label="Warehouse">
            <select
              value={warehouse?.id ?? ""}
              onChange={(event) => setWarehouseId(event.target.value)}
              className={inputClass}
            >
              {data?.warehouses.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Inventory item">
            <select
              value={item?.id ?? ""}
              onChange={(event) => setItemId(event.target.value)}
              className={inputClass}
            >
              {data?.items.map((row) => (
                <option key={`${row.warehouse_id ?? "all"}:${row.id}`} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity">
            <input
              value={quantity}
              inputMode="decimal"
              onChange={(event) => setQuantity(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Required by">
            <input
              type="datetime-local"
              value={requiredAt}
              onChange={(event) => setRequiredAt(event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        {!unitId && (
          <p className="text-[12px] text-warning">
            The selected inventory item needs a base or purchase unit before it can be requisitioned.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Btn onClick={() => onOpenChange(false)}>Close</Btn>
          <Btn
            variant="primary"
            disabled={!valid || busy}
            onClick={() =>
              valid &&
              void onSubmit({
                branchId,
                warehouseId: warehouse!.id,
                sourceType,
                ...(requiredAt ? { requiredAt: new Date(requiredAt).toISOString() } : {}),
                lines: [
                  {
                    inventoryItemId: item!.id,
                    requestedQuantityMicro: Math.round(Number(quantity) * 1_000_000),
                    unitId: unitId!,
                  },
                ],
              })
            }
          >
            Submit requisition
          </Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[12px] font-semibold">
      <span>{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "h-9 rounded-md border border-border bg-card px-3 text-[13px] outline-none focus:border-primary";
