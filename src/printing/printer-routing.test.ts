import { expect, it } from "vitest";
import { SerametPrintService, type BranchHardwareProfile } from "@/lib/seramet-print-service";

it("routes exact same-role stations and refuses ambiguity, disabled and unmapped printers", () => {
  const device = (id: string, station: string) => ({
    id,
    name: id,
    branch: "Disposable",
    roles: ["KITCHEN" as const],
    connection: "Unknown" as const,
    lastPrintAt: "Never",
    queue: 0,
    failures: 0,
    enabled: true,
    configuredTransport: true,
    stationKeys: [station],
  });
  const profile = {
    printers: [device("main", "MAIN KITCHEN"), device("grill", "GRILL")],
    documentRoutes: { FOOD_KOT: { primaryRole: "KITCHEN", copies: 1, template: "80mm" } },
    stationRoutes: {},
  } as unknown as BranchHardwareProfile;
  expect(SerametPrintService.resolvePrinter(profile, "FOOD_KOT", "GRILL").printer?.id).toBe(
    "grill",
  );
  expect(SerametPrintService.resolvePrinter(profile, "FOOD_KOT", "FRYER").routeMode).toBe("failed");
  profile.printers[1].enabled = false;
  expect(SerametPrintService.resolvePrinter(profile, "FOOD_KOT", "GRILL").routeMode).toBe("failed");
  profile.printers.push(device("duplicate", "MAIN KITCHEN"));
  expect(() => SerametPrintService.resolvePrinter(profile, "FOOD_KOT", "MAIN KITCHEN")).toThrow(
    "main and duplicate are both set to print MAIN KITCHEN tickets",
  );
});
