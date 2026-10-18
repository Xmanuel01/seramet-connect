/** Unimplemented presentation registers must not masquerade as empty authoritative logs. */
export const pilotUnavailable: Readonly<Record<string, string>> = {
  "/returns": "Item returns",
  "/audit-trail": "Global audit log",
  "/notifications": "Global notification log",
  "/tasks": "Task register",
  "/decisions": "Decision register",
  "/leave": "Leave management",
  "/recruitment": "Recruitment",
};
