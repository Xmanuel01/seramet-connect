import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, ShieldAlert } from "lucide-react";
import { Status } from "@/components/app/ui";
import type { ReadinessStatus, SetupStageStatus } from "@/onboarding/types";
import { cn } from "@/lib/utils";

export function SetupStatus({ value }: { value: ReadinessStatus | SetupStageStatus | string }) {
  const label = value.replaceAll("_", " ");
  if (value === "READY" || value === "COMPLETE" || value === "SUCCESS" || value === "LIVE") {
    return <Status>{label}</Status>;
  }
  if (value === "BLOCKED" || value === "FAILED") {
    return <Status className="bg-danger/10 text-danger">{label}</Status>;
  }
  if (value === "WARNING" || value === "IN_PROGRESS" || value === "DEVICE_OFFLINE") {
    return <Status className="bg-warning/10 text-warning">{label}</Status>;
  }
  return <Status className="bg-info/10 text-info">{label}</Status>;
}

export function SetupStageIcon({ status }: { status: SetupStageStatus }) {
  if (status === "COMPLETE" || status === "READY")
    return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (status === "BLOCKED") return <ShieldAlert className="h-4 w-4 text-danger" />;
  if (status === "IN_PROGRESS") return <AlertTriangle className="h-4 w-4 text-warning" />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
}

export function SetupTab({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 shrink-0 border-b-2 px-3 text-[12px] font-semibold",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
