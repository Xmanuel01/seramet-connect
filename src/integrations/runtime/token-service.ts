import type { ProviderToken } from "@/integrations/runtime/models";

export class ProviderTokenService {
  private tokens = new Map<string, ProviderToken>();
  private refreshes = new Map<string, Promise<ProviderToken>>();

  async getValidToken(
    connectionId: string,
    acquire: () => Promise<ProviderToken>,
    refreshWindowMs = 60_000,
  ) {
    const current = this.tokens.get(connectionId);
    if (current && new Date(current.expiresAt).getTime() - Date.now() > refreshWindowMs) {
      return current;
    }
    const pending = this.refreshes.get(connectionId);
    if (pending) return pending;
    const refresh = acquire()
      .then((token) => {
        if (token.connectionId !== connectionId)
          throw new Error("Provider token connection mismatch");
        this.tokens.set(connectionId, token);
        return token;
      })
      .finally(() => this.refreshes.delete(connectionId));
    this.refreshes.set(connectionId, refresh);
    return refresh;
  }

  invalidate(connectionId: string) {
    this.tokens.delete(connectionId);
  }

  clear() {
    this.tokens.clear();
    this.refreshes.clear();
  }
}
