import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";

const goto: { label: string; to: string }[] = [
  { label: "Go to Home Dashboard", to: "/" },
  { label: "Go to Seramet POS", to: "/pos" },
  { label: "Go to Tables", to: "/tables" },
  { label: "Go to Kitchen Display", to: "/kitchen" },
  { label: "Go to Inventory", to: "/inventory" },
  { label: "Go to Orders", to: "/orders" },
  { label: "Go to Procurement", to: "/procurement" },
  { label: "Go to People", to: "/people" },
  { label: "Go to Finance", to: "/finance" },
  { label: "Go to Command Centre", to: "/command-centre" },
  { label: "Go to Approvals", to: "/approvals" },
  { label: "Ask Seramet AI", to: "/ai" },
  { label: "Go to Reports", to: "/reports" },
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
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search orders, receipts, customers, items… or type a command" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Records matching “1842”">
          <CommandItem>Order #1842 · Table 12 · KSh 4,850</CommandItem>
          <CommandItem>Receipt #1842 · M-Pesa · Westlands</CommandItem>
          <CommandItem>Invoice INV-1842 · Kelvin Otieno</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Navigate">
          {goto.map((g) => (
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