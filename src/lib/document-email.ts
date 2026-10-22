export type DocumentRecipient = { name: string; email: string };

export function validateDocumentRecipient(recipient: DocumentRecipient) {
  if (!recipient.name.trim() || recipient.name.length > 120 || /[\r\n]/.test(recipient.name))
    throw new Error("Enter the recipient's name (up to 120 characters).");
  if (
    recipient.email.length > 254 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(
      recipient.email.trim(),
    )
  )
    throw new Error("Enter one valid recipient email address.");
  return { name: recipient.name.trim(), email: recipient.email.trim() };
}

export function documentEmailLink(recipient: DocumentRecipient, title: string, content: string) {
  const validated = validateDocumentRecipient(recipient);
  if (!title.trim() || /[\r\n]/.test(title) || !content.trim())
    throw new Error("The document is not available to email.");
  const body = `Hello ${validated.name},\n\n${content}\n\nThank you.`;
  const link = `mailto:${encodeURIComponent(validated.email)}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  // Mail clients impose different URL limits; never silently truncate a financial document.
  if (link.length > 16000)
    throw new Error(
      "This document is too long for an email draft. Download the PDF and attach it in your mail app.",
    );
  return link;
}
