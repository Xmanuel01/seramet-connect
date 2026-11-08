/** A random 6-digit PIN the server accepts: no runs like 123456 and no repeats like 111111. */
export function randomPin() {
  for (;;) {
    const [value] = crypto.getRandomValues(new Uint32Array(1));
    // Discard the top slice so every PIN is equally likely.
    if (value >= 4_294_000_000) continue;
    const pin = String(value % 1_000_000).padStart(6, "0");
    const predictable =
      "01234567890123456789".includes(pin) ||
      "98765432109876543210".includes(pin) ||
      new Set(pin).size === 1;
    if (!predictable) return pin;
  }
}
