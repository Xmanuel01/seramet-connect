export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-primary">
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" width={18} height={18}>
          <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" stroke="var(--color-primary-foreground)" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M12 8.2 8 10.4v3.2L12 15.8l4-2.2v-3.2L12 8.2Z" fill="var(--color-primary-foreground)" />
        </svg>
      </div>
      {!compact && (
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[15px] font-extrabold tracking-tight">Seramet</div>
          <div className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Business OS
          </div>
        </div>
      )}
    </div>
  );
}