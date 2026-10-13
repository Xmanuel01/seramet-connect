const categories = {
  ENOTFOUND: "DNS_RESOLUTION",
  EAI_AGAIN: "DNS_RESOLUTION",
  ECONNREFUSED: "TCP_CONNECTION",
  ENETUNREACH: "TCP_CONNECTION",
  EHOSTUNREACH: "TCP_CONNECTION",
  ETIMEDOUT: "CONNECTION_TIMEOUT",
  ECONNRESET: "CONNECTION_RESET",
  ERR_TLS_CERT_ALTNAME_INVALID: "TLS_HOSTNAME_VALIDATION",
  CERT_HAS_EXPIRED: "TLS_CERTIFICATE_VALIDATION",
  CERT_NOT_YET_VALID: "TLS_CERTIFICATE_VALIDATION",
  DEPTH_ZERO_SELF_SIGNED_CERT: "TLS_CERTIFICATE_VALIDATION",
  SELF_SIGNED_CERT_IN_CHAIN: "TLS_CERTIFICATE_VALIDATION",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS_CERTIFICATE_VALIDATION",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "TLS_CERTIFICATE_VALIDATION",
  ERR_SSL_WRONG_VERSION_NUMBER: "TLS_HANDSHAKE",
  ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION: "TLS_HANDSHAKE",
  "28P01": "DATABASE_AUTHENTICATION",
  28000: "DATABASE_AUTHENTICATION",
  "3D000": "DATABASE_SELECTION",
  42501: "SQL_PERMISSION",
  "42P01": "SQL_SCHEMA",
  42703: "SQL_SCHEMA",
  42883: "SQL_SCHEMA",
  57014: "SQL_TIMEOUT_OR_CANCELLATION",
  "55P03": "SQL_LOCK",
  53300: "DATABASE_CAPACITY",
  "57P03": "DATABASE_UNAVAILABLE",
};
const stages = new Set(["configuration", "connect", "query"]);

export function databaseFailureDiagnostic(error, stage) {
  const safeStage = stages.has(stage) ? stage : "unknown";
  // Do not serialize Error, message, detail, cause, certificate, host or SQL.
  if (Object.hasOwn(categories, error?.code)) {
    return { stage: safeStage, category: categories[error.code], code: error.code };
  }
  if (error instanceof AggregateError) {
    for (const child of error.errors) {
      if (Object.hasOwn(categories, child?.code)) {
        return { stage: safeStage, category: categories[child.code], code: child.code };
      }
    }
  }
  return { stage: safeStage, category: "UNCLASSIFIED_FAILURE", code: "UNKNOWN" };
}
