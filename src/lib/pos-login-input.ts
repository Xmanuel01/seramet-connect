export function shouldCapturePinKeyboardEvent(target: EventTarget | null) {
  if (!target || typeof target !== "object") return true;
  const candidate = target as { tagName?: unknown; isContentEditable?: unknown };
  const tagName = typeof candidate.tagName === "string" ? candidate.tagName.toUpperCase() : "";
  return (
    candidate.isContentEditable !== true &&
    tagName !== "INPUT" &&
    tagName !== "TEXTAREA" &&
    tagName !== "SELECT"
  );
}

export function pinAfterIdentityChange(currentIdentity: string, nextIdentity: string, pin: string) {
  return currentIdentity === nextIdentity ? pin : "";
}
