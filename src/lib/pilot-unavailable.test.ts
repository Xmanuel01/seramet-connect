import { expect, it } from "vitest";
import { pilotUnavailable } from "./pilot-unavailable";
import { getVisibleNavGroups } from "@/components/app/nav";
import { allPermissionCodes } from "@/platform/permissions";
it("hides only confirmed unimplemented registers without changing journal or payment control", () => {
  const paths = getVisibleNavGroups("Owner", undefined, [...allPermissionCodes]).flatMap((group) =>
    group.items.map((item) => item.to),
  );
  for (const path of Object.keys(pilotUnavailable)) expect(paths).not.toContain(path);
  for (const path of ["/daily-sales-journal", "/payment-control"]) {
    expect(pilotUnavailable[path]).toBeUndefined();
    expect(paths).toContain(path);
  }
});
