import { useEffect, useRef, useState } from "react";
import { solidRules } from "../../../printing-core/solid-rules.mjs";

// Preserve printer columns, scaling the whole sheet rather than wrapping table rows.
// Table borders show as the solid lines text-mode printers draw; a line height
// of one em lets the vertical borders of adjacent rows meet, as on paper.
export function DocumentTextPreview({ content }: { content: string }) {
  const container = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLPreElement>(null);
  const [size, setSize] = useState({ scale: 1, width: 0, height: 0 });
  useEffect(() => {
    const outer = container.current;
    const inner = sheet.current;
    if (!outer || !inner) return;
    const measure = () => {
      const width = inner.offsetWidth;
      const height = inner.offsetHeight;
      setSize({ scale: Math.min(1, outer.clientWidth / Math.max(width, 1)), width, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    measure();
    return () => observer.disconnect();
  }, [content]);
  return (
    <div ref={container} className="min-w-0 w-full overflow-hidden" data-testid="document-preview">
      <div
        className="relative mx-auto"
        style={{
          width: size.width * size.scale || "100%",
          height: size.height * size.scale || undefined,
        }}
      >
        <pre
          ref={sheet}
          className="m-0 w-max whitespace-pre border border-neutral-300 bg-white p-4 font-mono text-[11px] leading-none text-black"
          style={{ transform: `scale(${size.scale})`, transformOrigin: "top left" }}
        >
          {solidRules(content)}
        </pre>
      </div>
    </div>
  );
}
