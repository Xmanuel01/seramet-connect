import { describe, expect, it } from "vitest";
import { connectionPresentation, syncActivityLabel } from "./pos-sync-status";

describe("POS connectivity and synchronization display", () => {
  it("keeps stable online connectivity during server-side saves", () => {
    expect(connectionPresentation("synced")).toMatchObject({ health: "online", label: "Online" });
    expect(syncActivityLabel("synced", 1, 0)).toBe("Saving");
    expect(syncActivityLabel("synced", 0, 0)).toBeNull();
  });

  it("shows offline work separately even when the connection is healthy", () => {
    expect(connectionPresentation("synced").label).toBe("Online");
    expect(syncActivityLabel("synced", 0, 3)).toBe("3 offline commands pending");
    expect(syncActivityLabel("synced", 0, 1, true)).toBe("Replaying 1 offline command");
    expect(syncActivityLabel("synced", 1, 2)).toBe("Saving · 2 offline commands pending");
  });

  it("never mislabels a server failure or conflict as an internet outage", () => {
    expect(connectionPresentation("error").label).toBe("Server issue");
    expect(connectionPresentation("conflict").label).toBe("Sync conflict");
    expect(connectionPresentation("offline").label).toBe("Connection lost");
    expect(connectionPresentation("synced", false).label).toBe("Internet offline");
    expect(connectionPresentation("error", true).label).toBe("Server issue");
    expect(connectionPresentation("loading").label).toBe("Connecting");
  });
});
