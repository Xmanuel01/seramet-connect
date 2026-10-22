import { describe, expect, it } from "vitest";
import { documentEmailLink, validateDocumentRecipient } from "./document-email";

describe("document email recipient", () => {
  it("uses the explicitly entered recipient and includes the actual document", () => {
    const link = documentEmailLink(
      { name: " Amina ", email: " amina@example.com " },
      "Invoice INV-27",
      "TAX INVOICE\nRice  200.00\nTOTAL 200.00",
    );
    expect(link).toMatch(/^mailto:amina%40example.com\?/);
    const query = new URLSearchParams(link.split("?")[1]);
    expect(query.get("subject")).toBe("Invoice INV-27");
    expect(query.get("body")).toContain("Hello Amina,");
    expect(query.get("body")).toContain("Rice  200.00\nTOTAL 200.00");
  });
  it.each([
    "",
    "bad",
    "one@example.com,two@example.com",
    "one@example.com\r\nBcc:other@example.com",
    "one@example.com?bcc=other@example.com",
  ])("rejects invalid or injected addresses: %j", (email) => {
    expect(() => validateDocumentRecipient({ name: "Amina", email })).toThrow();
  });
  it.each(["", "\n", "Name\r\nBcc:other@example.com", "x".repeat(121)])(
    "requires a valid recipient name",
    (name) => {
      expect(() => validateDocumentRecipient({ name, email: "amina@example.com" })).toThrow();
    },
  );
  it("rejects oversized documents rather than emailing incomplete amounts", () => {
    expect(() =>
      documentEmailLink(
        { name: "Amina", email: "amina@example.com" },
        "Receipt",
        "x".repeat(17000),
      ),
    ).toThrow("too long");
  });
  it("rejects missing documents and header injection", () => {
    const recipient = { name: "Amina", email: "amina@example.com" };
    expect(() =>
      documentEmailLink(recipient, "Invoice\r\nBcc:other@example.com", "TOTAL 200"),
    ).toThrow();
    expect(() => documentEmailLink(recipient, "Invoice", "")).toThrow();
  });
});
