import { resolve } from "node:path";
// @ts-expect-error - plain ESM test helper without type declarations
import { startFakeSupabaseAuth } from "../../scripts/e2e/fake-supabase-auth.mjs";

export default async function globalSetup() {
  const auth = await startFakeSupabaseAuth({
    port: 54329,
    keyFile: resolve(".seramet/journey/auth-key.pem"),
    certFile: resolve(".seramet/journey/auth-cert.pem"),
  });
  return () => auth.close();
}
