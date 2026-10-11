import { describe, expect, it } from "vitest";
import { pinAfterIdentityChange, shouldCapturePinKeyboardEvent } from "@/lib/pos-login-input";

describe("POS login input boundaries", () => {
  it.each(["INPUT", "textarea", "Select"])(
    "does not treat digits typed into %s as PIN input",
    (tagName) => {
      expect(shouldCapturePinKeyboardEvent({ tagName } as unknown as EventTarget)).toBe(false);
    },
  );

  it("does not capture digits from content-editable controls", () => {
    expect(
      shouldCapturePinKeyboardEvent({
        tagName: "DIV",
        isContentEditable: true,
      } as unknown as EventTarget),
    ).toBe(false);
  });

  it("captures keypad-style keyboard input outside editable controls", () => {
    expect(shouldCapturePinKeyboardEvent({ tagName: "BUTTON" } as unknown as EventTarget)).toBe(
      true,
    );
  });

  it("clears a PIN when employee identity changes", () => {
    expect(pinAfterIdentityChange("employee-1", "employee-2", "1234")).toBe("");
    expect(pinAfterIdentityChange("employee-1", "employee-1", "1234")).toBe("1234");
  });
});
