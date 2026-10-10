import { describe, expect, it } from "vitest";
import { integrationWebhookAcknowledgement } from "@/lib/seramet-api";

describe("integration webhook acknowledgements", () => {
  it("acknowledges Uber Eats with an empty 200 response", async () => {
    const response = integrationWebhookAcknowledgement("UBER_EATS", {
      accepted: true,
      duplicate: false,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("preserves the structured acknowledgement for other providers", async () => {
    const response = integrationWebhookAcknowledgement("GLOVO", {
      accepted: true,
      duplicate: true,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      accepted: true,
      duplicate: true,
    });
  });
});
