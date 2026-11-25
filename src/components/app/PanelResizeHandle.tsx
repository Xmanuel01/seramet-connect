import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { usePanelWidth } from "@/hooks/use-panel-width";
import { cn } from "@/lib/utils";

/**
 * A thin vertical bar that resizes the panel beside it. Drag it, use the arrow keys
 * when it has focus, or double-click to go back to the default width.
 * `side` says which panel it resizes: "left" grows as you drag right, "right" grows as
 * you drag left.
 */
export function PanelResizeHandle({
  label,
  side,
  panel,
  className,
  style,
}: {
  label: string;
  side: "left" | "right";
  panel: ReturnType<typeof usePanelWidth>;
  className?: string;
  style?: CSSProperties;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };
  }, [dragging]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={panel.width}
      aria-valuemin={panel.min}
      aria-valuemax={panel.max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, width: panel.width };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        const delta = event.clientX - start.current.x;
        panel.setWidth(start.current.width + (side === "left" ? delta : -delta));
      }}
      onPointerUp={(event) => {
        start.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        start.current = null;
        setDragging(false);
      }}
      onDoubleClick={panel.reset}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 10;
        const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
        const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
        if (event.key === grow) panel.setWidth(panel.width + step);
        else if (event.key === shrink) panel.setWidth(panel.width - step);
        else return;
        event.preventDefault();
      }}
      style={style}
      className={cn(
        "group absolute inset-y-0 z-20 w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none",
        className,
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full transition-colors",
          dragging
            ? "bg-primary"
            : "bg-transparent group-hover:bg-primary/40 group-focus-visible:bg-primary/60",
        )}
      />
    </div>
  );
}
