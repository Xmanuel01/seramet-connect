import { expect, it } from "vitest";
import { pilotUnavailable } from "./pilot-unavailable";
import { getVisibleNavGroups } from "@/components/app/nav";
import { allPermissionCodes } from "@/platform/permissions";
it("hides only confirmed unimplemented registers without changing ledger, statements or payments", () => {
  const paths = getVisibleNavGroups("Owner", undefined, [...allPermissionCodes]).flatMap((group) =>
    group.items.map((item) => item.to),
  );
  for (const path of Object.keys(pilotUnavailable)) expect(paths).not.toContain(path);
  for (const path of ["/general-ledger", "/statements", "/payment-control"]) {
    expect(pilotUnavailable[path]).toBeUndefined();
    expect(paths).toContain(path);
  }
});
