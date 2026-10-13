import assert from "node:assert/strict";
import test from "node:test";
import { databaseFailureDiagnostic } from "./staging-database-diagnostics.mjs";

test("classifies DNS, TCP, TLS, authentication and SQL without reflecting sensitive fields", () => {
  for (const [code, category, stage] of [
    ["ENOTFOUND", "DNS_RESOLUTION", "connect"],
    ["ECONNREFUSED", "TCP_CONNECTION", "connect"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "TLS_HOSTNAME_VALIDATION", "connect"],
    ["SELF_SIGNED_CERT_IN_CHAIN", "TLS_CERTIFICATE_VALIDATION", "connect"],
    ["ERR_SSL_WRONG_VERSION_NUMBER", "TLS_HANDSHAKE", "connect"],
    ["28P01", "DATABASE_AUTHENTICATION", "connect"],
    ["42501", "SQL_PERMISSION", "query"],
  ]) {
    const error = Object.assign(new Error("postgresql://private:password@secret-host"), {
      code,
      detail: "secret SQL",
      cert: "private certificate",
      host: "private host",
    });
    assert.deepEqual(databaseFailureDiagnostic(error, stage), { stage, category, code });
  }
});
test("unknown codes and stages are redacted rather than guessed", () => {
  assert.deepEqual(
    databaseFailureDiagnostic({ code: "password-secret", message: "secret" }, "secret"),
    {
      stage: "unknown",
      category: "UNCLASSIFIED_FAILURE",
      code: "UNKNOWN",
    },
  );
  assert.equal(
    databaseFailureDiagnostic(new Error("secret"), "configuration").stage,
    "configuration",
  );
});
test("classifies Node aggregate TCP connection errors without logging their contents", () => {
  const error = new AggregateError([{ code: "ECONNREFUSED", address: "secret" }], "secret");
  assert.deepEqual(databaseFailureDiagnostic(error, "connect"), {
    stage: "connect",
    category: "TCP_CONNECTION",
    code: "ECONNREFUSED",
  });
});
