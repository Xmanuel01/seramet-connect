import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoleAccessEditor } from "@/components/app/RoleAccessEditor";
import { accessAreas, permissionLabel, platformOnlyPermissions } from "@/platform/access-areas";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import { accountOwnerPermissions } from "@/platform/standard-roles";
import { staffRolePresets } from "@/platform/staff-role-presets";

const render = (
  rolePermissions: readonly string[],
  options: { grantable?: readonly string[] | "all"; readOnly?: boolean } = {},
) =>
  renderToStaticMarkup(
    createElement(RoleAccessEditor, {
      roleName: "Cashier",
      permissions: rolePermissions,
      grantable: options.grantable ?? "all",
      readOnly: options.readOnly ?? false,
      onSave: async () => ({ ok: true, message: "Saved." }),
    }),
  );

/** The level choices on the screen, in order. */
const choices = (html: string) =>
  [...html.matchAll(/<input type="radio"[^>]*>/g)].map((match) => ({
    label: /aria-label="([^"]+)"/.exec(match[0])![1]!.replaceAll("&amp;", "&"),
    checked: /\schecked=""/.test(match[0]),
    disabled: /\sdisabled=""/.test(match[0]),
  }));
const chosen = (html: string) =>
  Object.fromEntries(
    choices(html)
      .filter((choice) => choice.checked)
      .map((choice) => choice.label.split(": ") as [string, string]),
  );

describe("role access screen", () => {
  it("shows one choice per area with the role's current level selected", () => {
    const html = render(staffRolePresets.cashier!.permissions);
    const selected = chosen(html);
    expect(Object.keys(selected)).toEqual(accessAreas.map((area) => area.label));
    expect(selected["Sales & POS"]).toBe("Sell");
    expect(selected["Staff"]).toBe("Own attendance");
    expect(selected["Kitchen & recipes"]).toBe("No access");
    expect(selected["Finance"]).toBe("No access");
    expect(html).toContain("What Cashier can do");
    // The selected level says what the person can do.
    expect(html).toContain("Use the POS: take and serve orders");
    expect(html).toContain("Clock in and out for their own shifts.");
  });

  it("offers every level of every area and no Custom unless the role is custom", () => {
    const labels = choices(render([])).map((choice) => choice.label);
    expect(labels).toEqual(
      accessAreas.flatMap((area) => [
        `${area.label}: No access`,
        ...area.levels.map((level) => `${area.label}: ${level.label}`),
      ]),
    );
  });

  it("shows a role that matches no level as Custom", () => {
    const html = render([permissions.posAccess, permissions.ordersCancel]);
    expect(chosen(html)["Sales & POS"]).toBe("Custom");
    expect(html).toContain("A mix picked one by one.");
    expect(html).toMatch(/Advanced: pick one by one \((<!-- -->)?2(<!-- -->)? of (<!-- -->)?23/);
  });

  it("shows an owner as Full control everywhere", () => {
    const selected = chosen(render(accountOwnerPermissions));
    expect(new Set(Object.values(selected))).toEqual(new Set(["Full control"]));
  });

  it("never shows a permission code, and never offers platform permissions", () => {
    const html = render([...allPermissionCodes, "future.permission.code"]);
    for (const code of allPermissionCodes) expect(html, code).not.toContain(code);
    for (const code of platformOnlyPermissions) {
      expect(html, code).not.toContain(permissionLabel(code));
    }
    const boxes = html.match(/<input type="checkbox"/g) ?? [];
    expect(boxes.length).toBe(accountOwnerPermissions.length);
    // The individual permissions sit inside collapsed Advanced sections.
    expect(html).not.toContain("<details open");
    expect((html.match(/<details/g) ?? []).length).toBe(accessAreas.length);
  });

  it("has nothing to save until something is changed", () => {
    const html = render(staffRolePresets.chef!.permissions);
    expect(html).toContain("No changes to save.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save changes<\/button>/);
  });

  it("locks every choice for someone who may not change roles", () => {
    const html = render(staffRolePresets.chef!.permissions, { readOnly: true });
    expect(choices(html).every((choice) => choice.disabled)).toBe(true);
    expect(html).not.toMatch(/<input type="checkbox"(?![^>]*disabled="")/);
    expect(html).not.toContain("Start from a ready-made role");
  });

  it("greys out levels that would give access the grantor does not hold", () => {
    const html = render(staffRolePresets.chef!.permissions, {
      grantable: [...staffRolePresets.supervisor!.permissions],
    });
    const byLabel = Object.fromEntries(choices(html).map((choice) => [choice.label, choice]));
    // A supervisor holds everything in Cook and View, so can move the role between them.
    expect(byLabel["Kitchen & recipes: View"]!.disabled).toBe(false);
    expect(byLabel["Kitchen & recipes: No access"]!.disabled).toBe(false);
    // Batch preparation, payroll and the till are outside what the supervisor holds.
    expect(byLabel["Kitchen & recipes: Run the kitchen"]!.disabled).toBe(true);
    expect(byLabel["Staff: Full control"]!.disabled).toBe(true);
    expect(byLabel["Sales & POS: Sell"]!.disabled).toBe(true);
    expect(html).toContain("you can only give or remove access that you have yourself");
  });
});
