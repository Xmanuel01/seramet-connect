export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div
      className="flex min-w-0 items-center gap-2.5"
      role={compact ? "img" : undefined}
      aria-label={compact ? "Seramet" : undefined}
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center" aria-hidden="true">
        <img
          src="/brand/seramet-mark-light.png"
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 object-contain dark:hidden"
        />
        <img
          src="/brand/seramet-mark-dark.png"
          alt=""
          width={36}
          height={36}
          className="hidden h-9 w-9 object-contain dark:block"
        />
      </div>
      {!compact && (
        <span className="truncate text-[17px] font-semibold tracking-normal text-foreground">
          SERAMET
        </span>
      )}
    </div>
  );
}
