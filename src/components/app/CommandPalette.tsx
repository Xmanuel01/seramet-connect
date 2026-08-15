import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { roleCanAccessPath } from "@/components/app/nav";
import { useAppContext } from "@/lib/app-context";

const goto: { label: string; to: string }[] = [
  { label: "Go to Home Dashboard", to: "/" },
  { label: "Go to Seramet POS", to: "/pos" },
  { label: "Go to Tables", to: "/tables" },
  { label: "Go to Kitchen Display", to: "/kitchen" },
  { label: "Open Menu Import", to: "/menu-import" },
  { label: "Go to Inventory", to: "/inventory" },
  { label: "Open Inventory Categories", to: "/categories" },
  { label: "Open Stock Detail", to: "/stock-detail" },
  { label: "Open Breakages", to: "/breakages" },
  { label: "Go to Orders", to: "/orders" },
  { label: "Go to Procurement", to: "/procurement" },
  { label: "Open Requisitions", to: "/requisitions" },
  { label: "Open Purchase Orders", to: "/purchase-orders" },
  { label: "Open Receiving", to: "/receiving" },
  { label: "Open Supplier 360", to: "/suppliers" },
  { label: "Open Supplier Bills", to: "/supplier-bills" },
  { label: "Open Supplier Performance", to: "/supplier-performance" },
  { label: "Open CRM Overview", to: "/crm" },
  { label: "Open CRM Pipeline", to: "/crm-pipeline" },
  { label: "Open Loyalty", to: "/loyalty" },
  { label: "Open Complaints", to: "/complaints" },
  { label: "Go to People", to: "/people" },
  { label: "Open Employee 360", to: "/employees" },
  { label: "Open Attendance", to: "/attendance" },
  { label: "Open Schedule", to: "/schedule" },
  { label: "Open Payroll", to: "/payroll" },
  { label: "Go to Finance", to: "/finance" },
  { label: "Open Profit & Loss", to: "/profit-loss" },
  { label: "Open Balance Sheet", to: "/balance-sheet" },
  { label: "Open Cash Flow", to: "/cash-flow" },
  { label: "Open Expenses", to: "/expenses" },
  { label: "Open Payables", to: "/payables" },
  { label: "Open Receivables", to: "/receivables" },
  { label: "Open Assets", to: "/assets" },
  { label: "Go to Command Centre", to: "/command-centre" },
  { label: "Open Pending Decisions", to: "/decisions" },
  { label: "Open Branches", to: "/branches" },
  { label: "Go to Approvals", to: "/approvals" },
  { label: "Open Tasks", to: "/tasks" },
  { label: "Open Audit Trail", to: "/audit-trail" },
  { label: "Ask Seramet AI", to: "/ai" },
  { label: "Go to Reports", to: "/reports" },
  { label: "Open Seramet Printers", to: "/seramet-printers" },
  { label: "Open Hardware Setup", to: "/seramet-setup" },
  { label: "Go to Settings", to: "/settings" },
  { label: "Open Design System", to: "/design-system" },
];

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const { role, branch } = useAppContext();
  const availableGoto = goto.filter((item) => roleCanAccessPath(role, item.to, branch));
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search orders, receipts, customers, items... or type a command" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading={`Records matching 1842 - ${branch}`}>
          <CommandItem>Order #1842 - Table 12 - KSh 4,850</CommandItem>
          <CommandItem>Receipt #1842 - M-Pesa - Westlands</CommandItem>
          <CommandItem>Invoice INV-1842 - Kelvin Otieno</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Navigate">
          {availableGoto.map((g) => (
            <CommandItem
              key={g.to + g.label}
              onSelect={() => {
                onOpenChange(false);
                navigate({ to: g.to });
              }}
            >
              {g.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
