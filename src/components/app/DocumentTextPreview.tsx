import { useEffect, useRef, useState } from "react";
import { solidRules } from "../../../printing-core/solid-rules.mjs";
import { renderRichDocument, type RichDocument } from "../../../printing-core/rich-render.mjs";

const PREVIEW_DOTS = { "80mm": 576, "58mm": 384 } as const;

/**
 * The approved typeset document, drawn from the same bitmap the print bridge
 * sends to an image-mode printer, one dot per pixel.
 */
export function RichDocumentPreview({ document }: { document: RichDocument }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const bitmap = renderRichDocument(document, PREVIEW_DOTS[document.paper]);
    element.width = bitmap.width;
    element.height = bitmap.height;
    const image = context.createImageData(bitmap.width, bitmap.height);
    const stride = bitmap.width >> 3;
    for (let y = 0; y < bitmap.height; y++)
      for (let x = 0; x < bitmap.width; x++) {
        const on = bitmap.data[y * stride + (x >> 3)]! & (0x80 >> (x & 7));
        const i = (y * bitmap.width + x) * 4;
        image.data[i] = image.data[i + 1] = image.data[i + 2] = on ? 0 : 255;
        image.data[i + 3] = 255;
      }
    context.putImageData(image, 0, 0);
  }, [document]);
  return (
    <div className="min-w-0 w-full" data-testid="document-preview">
      <canvas
        ref={canvas}
        className="mx-auto block h-auto w-full max-w-[400px] border border-neutral-300 bg-white"
        aria-label="Print preview"
      />
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        As printed by printers set to Image. Printers set to Text print a plain-text version.
      </p>
    </div>
  );
}

// Preserve printer columns, scaling the whole sheet rather than wrapping table rows.
// Table borders show as the solid lines text-mode printers draw; a line height
// of one em lets the vertical borders of adjacent rows meet, as on paper.
export function DocumentTextPreview({ content, rich }: { content: string; rich?: RichDocument }) {
  if (rich) return <RichDocumentPreview document={rich} />;
  return <PlainTextPreview content={content} />;
}

function PlainTextPreview({ content }: { content: string }) {
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
