import { useCallback, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Btn } from "@/components/app/ui";

export type ReasonRequest = {
  title: string;
  description?: string;
  /** Prefilled reason, e.g. the usual wording for an approval. */
  defaultValue?: string;
  /** Shortest reason accepted (default 3 characters). */
  minLength?: number;
  /** One-tap reasons shown above the text box. */
  suggestions?: string[];
  confirmLabel?: string;
  destructive?: boolean;
};

type Pending = ReasonRequest & { resolve: (reason: string | null) => void };

/**
 * Asks for a reason in an in-app dialog instead of the browser's prompt box.
 * `await askReason({...})` resolves to the trimmed reason, or null when cancelled;
 * render `reasonDialog` once in the component.
 */
export function useReasonPrompt(): [(request: ReasonRequest) => Promise<string | null>, ReactNode] {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState("");
  const pendingRef = useRef<Pending | null>(null);

  const askReason = useCallback(
    (request: ReasonRequest) =>
      new Promise<string | null>((resolve) => {
        pendingRef.current?.resolve(null);
        const next = { ...request, resolve };
        pendingRef.current = next;
        setValue(request.defaultValue ?? "");
        setPending(next);
      }),
    [],
  );

  const finish = (reason: string | null) => {
    pendingRef.current?.resolve(reason);
    pendingRef.current = null;
    setPending(null);
  };

  const minLength = pending?.minLength ?? 3;
  const trimmed = value.trim();
  const tooShort = trimmed.length < minLength;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tooShort) finish(trimmed);
  };

  const reasonDialog = (
    <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && finish(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{pending?.title}</DialogTitle>
          {pending?.description && <DialogDescription>{pending.description}</DialogDescription>}
        </DialogHeader>
        <form id="reason-dialog-form" onSubmit={submit} className="grid gap-3">
          {pending?.suggestions && pending.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pending.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setValue(suggestion)}
                  className={`rounded-full border px-3 py-1 text-[12px] ${
                    trimmed === suggestion
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-secondary"
                  }`}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          <label className="grid gap-1 text-[12px] font-semibold">
            Reason
            <textarea
              autoFocus
              rows={3}
              maxLength={500}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="rounded-md border border-border bg-background p-3 text-[13px] font-normal"
            />
          </label>
          {tooShort && trimmed.length > 0 && (
            <p className="text-[12px] text-muted-foreground">
              Use at least {minLength} characters.
            </p>
          )}
        </form>
        <DialogFooter className="gap-2">
          <Btn onClick={() => finish(null)}>Cancel</Btn>
          <Btn
            type="submit"
            form="reason-dialog-form"
            variant={pending?.destructive ? "danger" : "primary"}
            disabled={tooShort}
          >
            {pending?.confirmLabel ?? "Confirm"}
          </Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return [askReason, reasonDialog];
}
