import { AlertTriangle, LoaderCircle } from "lucide-react";
import { Btn } from "@/components/app/ui";

export function CrmLoading({ label = "Loading customer data" }: { label?: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center gap-2 text-[13px] text-muted-foreground">
      <LoaderCircle className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function CrmError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-6 text-center">
      <AlertTriangle className="h-6 w-6 text-warning" />
      <p className="max-w-lg text-[13px] text-muted-foreground">{message}</p>
      <Btn onClick={retry}>Retry</Btn>
    </div>
  );
}

export function CrmEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="text-[14px] font-semibold">{title}</div>
      <p className="mt-1 text-[13px] text-muted-foreground">{body}</p>
    </div>
  );
}

export function minorToMajor(value: number | null | undefined) {
  return Math.round(Number(value ?? 0)) / 100;
}

export function readableStatus(value: unknown) {
  return String(value ?? "Unknown")
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function shortDate(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
