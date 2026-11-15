/**
 * Each page's code is a separate file named after its content. After a deploy, a tab opened
 * earlier still asks for the previous files, which no longer exist, so opening another page
 * failed with "This page didn't load" until the browser was refreshed. These helpers recognise
 * that failure and load the current version of the app instead.
 */
const staleBuildPatterns = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /unable to preload css/i,
  /chunkloaderror/i,
  /loading (css )?chunk \S+ failed/i,
  /'text\/html' is not a valid javascript mime type/i,
];

export function isStaleBuildError(error: unknown): boolean {
  if (!error) return false;
  const text =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : String((error as { message?: unknown }).message ?? "");
  return staleBuildPatterns.some((pattern) => pattern.test(text));
}

const reloadKey = "seramet.stale-build-reload-at";
// One automatic reload per half minute, so a file that is missing for another reason can't
// trap the page in a reload loop.
const reloadWindowMs = 30_000;

/** Reloads the page to pick up the current build; false when it already did so just now. */
export function reloadForNewBuild(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = Number(window.sessionStorage.getItem(reloadKey) ?? 0);
    if (Date.now() - last < reloadWindowMs) return false;
    window.sessionStorage.setItem(reloadKey, String(Date.now()));
  } catch {
    // Storage may be unavailable (private mode); reload anyway, once per page load.
    if ((window as { __serametReloaded?: boolean }).__serametReloaded) return false;
    (window as { __serametReloaded?: boolean }).__serametReloaded = true;
  }
  window.location.reload();
  return true;
}

let installed = false;

/** Recovers when the bundler fails to preload a page's files (hovering or opening a link). */
export function installStaleBuildRecovery() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForNewBuild()) event.preventDefault();
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isStaleBuildError(event.reason)) reloadForNewBuild();
  });
}
