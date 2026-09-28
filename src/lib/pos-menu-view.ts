/** The POS never mounts the entire restaurant catalogue at once. */
export const INITIAL_POS_MENU_ITEMS = 20;
export const POS_MENU_PAGE_SIZE = 20;

export function visiblePosMenuItems<T>(matches: readonly T[], limit: number): T[] {
  const safeLimit = Number.isSafeInteger(limit)
    ? Math.max(INITIAL_POS_MENU_ITEMS, limit)
    : INITIAL_POS_MENU_ITEMS;
  return matches.slice(0, safeLimit);
}

export function shouldLoadNextPosMenuPage(input: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  displayed: number;
  total: number;
}) {
  return (
    input.total > input.displayed &&
    input.scrollHeight - input.scrollTop - input.clientHeight < 180
  );
}
