import type { LucideIcon } from "lucide-react";
import { Database, Plus } from "lucide-react";
import { Btn } from "@/components/app/ui";

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon: Icon = Database,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: LucideIcon;
}) {
  return (
    <div className="grid min-h-56 place-items-center px-5 py-10 text-center">
      <div className="max-w-md">
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-lg border border-border bg-secondary text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="mt-3 text-[14px] font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{description}</p>
        {actionLabel && onAction ? (
          <Btn className="mt-4" variant="primary" onClick={onAction}>
            <Plus className="h-4 w-4" />
            {actionLabel}
          </Btn>
        ) : null}
      </div>
    </div>
  );
}
