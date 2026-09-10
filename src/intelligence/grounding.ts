import { structuredIntelligenceAnswerSchema } from "@/intelligence/schemas";
import type { EvidencePackage, StructuredIntelligenceAnswer } from "@/intelligence/types";

const prohibitedCharacterJudgments = [
  /\bthief\b/i,
  /\bstole\b/i,
  /\bstealing\b/i,
  /\bdishonest\b/i,
  /\blazy\b/i,
  /\bnegligent\b/i,
  /\birresponsible\b/i,
  /\bemployee misconduct\b/i,
];

export class GroundingError extends Error {
  constructor(
    public readonly code:
      | "MALFORMED_OUTPUT"
      | "UNSUPPORTED_EVIDENCE_REFERENCE"
      | "UNSUPPORTED_NUMERIC_CLAIM"
      | "UNSUPPORTED_CAUSAL_CLAIM"
      | "UNSAFE_ACTION",
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

export function validateGroundedAnswer(
  raw: unknown,
  evidence: EvidencePackage,
): StructuredIntelligenceAnswer {
  const parsed = structuredIntelligenceAnswerSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GroundingError(
      "MALFORMED_OUTPUT",
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  const answer = normalizeAnswer(parsed.data as StructuredIntelligenceAnswer);
  const validRefs = new Set(evidence.sources.map((source) => source.ref));
  for (const ref of [
    ...answer.evidenceRefs,
    ...answer.keyFindings.flatMap((finding) => finding.evidenceRefs),
  ]) {
    if (!validRefs.has(ref)) {
      throw new GroundingError(
        "UNSUPPORTED_EVIDENCE_REFERENCE",
        `Answer referenced unavailable evidence ${ref}`,
      );
    }
  }
  const text = [
    answer.summary,
    ...answer.keyFindings.map((finding) => finding.statement),
    ...answer.limitations,
  ].join(" ");
  if (prohibitedCharacterJudgments.some((pattern) => pattern.test(text))) {
    throw new GroundingError(
      "UNSUPPORTED_CAUSAL_CLAIM",
      "Answer introduced an unsupported employee character or misconduct claim",
    );
  }
  assertNumericClaimsSupported(text, evidence);
  assertNamedEntitiesSupported(text, evidence);
  for (const finding of answer.keyFindings) {
    if (finding.classification === "CONFIRMED" && finding.evidenceRefs.length === 0) {
      throw new GroundingError(
        "UNSUPPORTED_CAUSAL_CLAIM",
        "A confirmed finding requires persisted evidence",
      );
    }
    if (
      finding.classification === "CONFIRMED" &&
      isCausalClaim(finding.statement) &&
      !evidence.findings.some(
        (supported) =>
          supported.classification === "CONFIRMED" &&
          supported.evidenceRefs.some((ref) => finding.evidenceRefs.includes(ref)) &&
          tokenOverlap(finding.statement, supported.statement) >= 0.6,
      )
    ) {
      throw new GroundingError(
        "UNSUPPORTED_CAUSAL_CLAIM",
        "A confirmed cause was not supported by the cited persisted finding",
      );
    }
  }
  const hasUnexplained = evidence.findings.some(
    (finding) => finding.classification === "UNEXPLAINED",
  );
  if (
    hasUnexplained &&
    !answer.keyFindings.some((finding) => finding.classification === "UNEXPLAINED")
  ) {
    throw new GroundingError(
      "UNSUPPORTED_CAUSAL_CLAIM",
      "The answer removed an unexplained evidence remainder",
    );
  }
  for (const action of answer.suggestedActions) {
    if (action.risk === "HIGH" && action.command) {
      throw new GroundingError("UNSAFE_ACTION", "High-risk actions cannot expose an AI command");
    }
    if (action.command && !action.requiresConfirmation) {
      throw new GroundingError("UNSAFE_ACTION", "Authoritative actions require confirmation");
    }
  }
  return answer;
}

function assertNamedEntitiesSupported(text: string, evidence: EvidencePackage) {
  const corpus = [
    ...evidence.branchLabels,
    ...evidence.findings.map((finding) => finding.statement),
    ...evidence.metrics.map((metric) => metric.label),
  ]
    .join(" ")
    .toLowerCase();
  const candidates = text.matchAll(
    /\b(?:Branch|branch|Supplier|supplier|Employee|employee|Station|station|Channel|channel)\s+([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,4})\b/g,
  );
  for (const candidate of candidates) {
    const entity = candidate[1]?.trim().toLowerCase();
    if (entity && !corpus.includes(entity)) {
      throw new GroundingError(
        "UNSUPPORTED_CAUSAL_CLAIM",
        `Answer introduced unsupported named entity ${candidate[0]}`,
      );
    }
  }
}

function isCausalClaim(value: string) {
  return /\b(?:because|caused|driven by|due to|resulted from|explains?|contributed)\b/i.test(value);
}

function tokenOverlap(left: string, right: string) {
  const ignored = new Set([
    "because",
    "caused",
    "driven",
    "due",
    "resulted",
    "from",
    "this",
    "that",
    "with",
    "the",
    "and",
    "for",
    "was",
    "were",
  ]);
  const tokens = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .match(/[a-z][a-z0-9-]{2,}/g)
        ?.filter((token) => !ignored.has(token)) ?? [],
    );
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size === 0) return 0;
  return [...leftTokens].filter((token) => rightTokens.has(token)).length / leftTokens.size;
}

function assertNumericClaimsSupported(text: string, evidence: EvidencePackage) {
  const scrubbed = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "");
  const claims = scrubbed.match(/[-+]?\d[\d,]*(?:\.\d+)?%?/g) ?? [];
  const allowed = supportedNumberTokens(evidence);
  for (const claim of claims) {
    const normalized = normalizeNumberToken(claim);
    if (!allowed.has(normalized)) {
      throw new GroundingError(
        "UNSUPPORTED_NUMERIC_CLAIM",
        `Answer introduced unsupported numeric claim ${claim}`,
      );
    }
  }
}

function supportedNumberTokens(evidence: EvidencePackage) {
  const allowed = new Set(["0", "100"]);
  for (const metric of evidence.metrics) {
    addNumberVariants(allowed, metric.value);
    if (metric.unit === "MINOR") addNumberVariants(allowed, metric.value / 100);
    if (metric.unit === "BPS") addNumberVariants(allowed, metric.value / 100, true);
  }
  for (const text of [
    ...evidence.branchLabels,
    ...evidence.findings.flatMap((finding) => [finding.title, finding.statement]),
    ...evidence.metrics.map((metric) => metric.label),
    ...evidence.qualityReasons,
    ...evidence.configurationGaps,
    ...evidence.limitations,
  ]) {
    for (const token of text.match(/[-+]?\d[\d,]*(?:\.\d+)?%?/g) ?? []) {
      allowed.add(normalizeNumberToken(token));
    }
  }
  return allowed;
}

function addNumberVariants(target: Set<string>, value: number, percent = false) {
  if (!Number.isFinite(value)) return;
  const variants = new Set([
    String(value),
    value.toFixed(0),
    value.toFixed(1),
    value.toFixed(2),
    value.toLocaleString("en-US", { maximumFractionDigits: 2 }),
  ]);
  for (const variant of variants) {
    target.add(normalizeNumberToken(variant));
    if (percent) target.add(normalizeNumberToken(`${variant}%`));
  }
}

function normalizeNumberToken(value: string) {
  const percent = value.endsWith("%");
  const numeric = Number(value.replace(/[,%]/g, ""));
  if (!Number.isFinite(numeric)) return value;
  const normalized = String(Number(numeric.toFixed(4)));
  return percent ? `${normalized}%` : normalized;
}

function normalizeAnswer(answer: StructuredIntelligenceAnswer): StructuredIntelligenceAnswer {
  const text = (value: string) =>
    stripControlCharacters(value)
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  return {
    ...answer,
    summary: text(answer.summary),
    keyFindings: answer.keyFindings.map((finding) => ({
      ...finding,
      statement: text(finding.statement),
    })),
    qualityReasons: answer.qualityReasons.map(text),
    limitations: answer.limitations.map(text),
    suggestedActions: answer.suggestedActions.map((action) => ({
      key: action.key,
      label: text(action.label),
      route: action.route,
      risk: action.risk,
      requiresConfirmation: action.requiresConfirmation,
      ...(action.command ? { command: action.command } : {}),
      ...(action.commandPayload ? { commandPayload: action.commandPayload } : {}),
    })),
  };
}

function stripControlCharacters(value: string) {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127
      ? " "
      : character;
  }).join("");
}
