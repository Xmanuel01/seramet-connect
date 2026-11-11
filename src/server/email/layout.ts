/**
 * Seramet's HTML email layout: table-based, inline styles and a single 600px column, which
 * is what Gmail, Outlook and mobile clients render reliably. Every email also gets a
 * plain-text version built from the same content.
 *
 * The logo is the official mark served over HTTPS by the app itself; no data: URLs.
 */

export type EmailBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "facts"; rows: Array<[label: string, value: string]> }
  | { kind: "action"; label: string; url: string }
  | { kind: "note"; text: string };

export type EmailContent = {
  /** Hidden preview line shown next to the subject in the inbox list. */
  preheader: string;
  heading: string;
  blocks: EmailBlock[];
  /** Who this email speaks for, shown in the footer (e.g. "Seramet Reports"). */
  senderName: string;
  /** Why the recipient is receiving this. */
  reason: string;
  /** Where help requests should go: an address that forwards today. */
  contactEmail: string;
  unsubscribeUrl?: string;
};

export type RenderedEmail = { html: string; text: string };

const brand = {
  ink: "#111827",
  muted: "#4b5563",
  line: "#e5e7eb",
  canvas: "#f3f4f6",
  card: "#ffffff",
  accent: "#0f766e",
};

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Only absolute HTTPS links (or a Supabase template variable) make it into an email. */
export function safeLink(url: string) {
  if (/^\{\{\s*\.[A-Za-z]+\s*\}\}$/.test(url)) return url;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error("EMAIL_LINK_INVALID");
  return parsed.toString();
}

/** The logo URL, or null when the public origin is not HTTPS (local development). */
export function logoUrl(publicOrigin: string | undefined) {
  try {
    const origin = new URL(publicOrigin ?? "");
    if (origin.protocol !== "https:") return null;
    return new URL("/brand/seramet-mark-light.png", origin).toString();
  } catch {
    return null;
  }
}

export function formatMoney(minor: number, currency = "KES") {
  const amount = minor / 100;
  try {
    return new Intl.NumberFormat("en-KE", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** "Tue, 11 Nov 2026" for a YYYY-MM-DD business date, without time-zone drift. */
export function formatBusinessDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Intl.DateTimeFormat("en-KE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function blockHtml(block: EmailBlock) {
  switch (block.kind) {
    case "paragraph":
      return `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${brand.ink};">${escapeHtml(block.text)}</p>`;
    case "note":
      return `<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:${brand.muted};">${escapeHtml(block.text)}</p>`;
    case "facts":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse;">${block.rows
        .map(
          ([label, value]) =>
            `<tr><td style="padding:8px 0;border-bottom:1px solid ${brand.line};font-size:14px;color:${brand.muted};">${escapeHtml(label)}</td><td align="right" style="padding:8px 0;border-bottom:1px solid ${brand.line};font-size:14px;font-weight:600;color:${brand.ink};">${escapeHtml(value)}</td></tr>`,
        )
        .join("")}</table>`;
    case "action": {
      const href = escapeHtml(safeLink(block.url));
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;"><tr><td style="border-radius:6px;background:${brand.accent};"><a href="${href}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(block.label)}</a></td></tr></table><p style="margin:0 0 16px;font-size:12px;line-height:18px;color:${brand.muted};word-break:break-all;">If the button does not work, open this link: ${href}</p>`;
    }
  }
}

function blockText(block: EmailBlock) {
  switch (block.kind) {
    case "paragraph":
    case "note":
      return block.text;
    case "facts":
      return block.rows.map(([label, value]) => `${label}: ${value}`).join("\n");
    case "action":
      return `${block.label}: ${safeLink(block.url)}`;
  }
}

export function renderEmail(content: EmailContent, publicOrigin?: string): RenderedEmail {
  const logo = logoUrl(publicOrigin);
  const unsubscribe = content.unsubscribeUrl ? safeLink(content.unsubscribeUrl) : null;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(content.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${brand.canvas};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${brand.canvas};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${brand.card};border:1px solid ${brand.line};border-radius:8px;">
<tr><td style="padding:24px 28px;border-bottom:1px solid ${brand.line};">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>${
    logo
      ? `<td style="padding-right:10px;"><img src="${escapeHtml(logo)}" width="36" height="36" alt="Seramet" style="display:block;border:0;width:36px;height:36px;"></td>`
      : ""
  }<td style="font-size:17px;font-weight:700;letter-spacing:0.5px;color:${brand.ink};">SERAMET</td></tr></table>
</td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 20px;font-size:21px;line-height:28px;font-weight:700;color:${brand.ink};">${escapeHtml(content.heading)}</h1>
${content.blocks.map(blockHtml).join("\n")}
</td></tr>
<tr><td style="padding:20px 28px;border-top:1px solid ${brand.line};font-size:12px;line-height:18px;color:${brand.muted};">
<p style="margin:0 0 6px;">Sent by ${escapeHtml(content.senderName)} · Seramet POS · seramet.co.ke</p>
<p style="margin:0 0 6px;">${escapeHtml(content.reason)}</p>
${unsubscribe ? `<p style="margin:0 0 6px;"><a href="${escapeHtml(unsubscribe)}" style="color:${brand.muted};">Unsubscribe from these emails</a></p>` : ""}
<p style="margin:0;">Need help? Write to ${escapeHtml(content.contactEmail)}.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  const text = [
    "SERAMET",
    "",
    content.heading,
    "",
    ...content.blocks.map((block) => `${blockText(block)}\n`),
    "--",
    `Sent by ${content.senderName} · Seramet POS · seramet.co.ke`,
    content.reason,
    ...(unsubscribe ? [`Unsubscribe: ${unsubscribe}`] : []),
    `Need help? Write to ${content.contactEmail}.`,
  ].join("\n");
  return { html, text };
}
