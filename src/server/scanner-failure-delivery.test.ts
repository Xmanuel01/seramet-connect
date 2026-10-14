import { describe, expect, it, vi } from "vitest";
import { persistScannerFailure } from "../../scanner-worker/src/failure-delivery";

describe("scanner terminal failure delivery", () => {
  it("does not acknowledge while the authoritative failure report is pending", async () => {
    const message = { ack: vi.fn(), retry: vi.fn() };
    let finish!: () => void;
    const delivery = persistScannerFailure(
      message,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    expect(message.ack).not.toHaveBeenCalled();
    finish();
    await delivery;
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("retains the queue obligation when reporting fails, including exhausted scans", async () => {
    const message = { ack: vi.fn(), retry: vi.fn() };
    await persistScannerFailure(message, async () => {
      throw new Error("Unavailable");
    });
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 300 });
  });

  it("acknowledges a redelivery only after the report succeeds", async () => {
    const message = { ack: vi.fn(), retry: vi.fn() };
    const report = vi
      .fn()
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValueOnce(undefined);
    await persistScannerFailure(message, report);
    await persistScannerFailure(message, report);
    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).toHaveBeenCalledOnce();
  });
});
