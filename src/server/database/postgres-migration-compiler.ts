export type CompiledPostgresMigration = {
  sql: string;
  triggerCount: number;
};

export const postgresCompatibilityPrelude = `
CREATE OR REPLACE FUNCTION json_extract(document TEXT, path TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_extract_path_text(
    document::jsonb,
    VARIADIC string_to_array(trim(leading '$.' from path), '.')
  )
$$;
`;

export function compileSqliteMigrationForPostgres(source: string): CompiledPostgresMigration {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let triggerCount = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^\s*PRAGMA\s+/i.test(line)) continue;
    if (!/^\s*CREATE\s+TRIGGER\b/i.test(line)) {
      output.push(line);
      continue;
    }
    const triggerLines = [line];
    let nesting = tokenDelta(line);
    let bodySeen = /\bBEGIN\b/i.test(line);
    while (++index < lines.length) {
      const next = lines[index]!;
      triggerLines.push(next);
      if (/\bBEGIN\b/i.test(next)) bodySeen = true;
      nesting += tokenDelta(next);
      if (bodySeen && nesting === 0) break;
    }
    output.push(compileTrigger(triggerLines.join("\n")));
    triggerCount += 1;
  }
  let sql = output.join("\n");
  sql = sql.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, "INSERT INTO");
  sql = sql.replace(/(\b[a-z_][a-z0-9_]*_(?:minor|bytes)\s+)INTEGER\b/gi, "$1BIGINT");
  sql = sql.replace(
    /ub\.rowid\s*=\s*\(\s*SELECT\s+MIN\(candidate\.rowid\)[\s\S]*?candidate\.user_id=ub\.user_id\s*\)/i,
    `NOT EXISTS (
      SELECT 1 FROM user_branches candidate
      WHERE candidate.tenant_id=ub.tenant_id AND candidate.user_id=ub.user_id
        AND candidate.branch_id < ub.branch_id
    )`,
  );
  return { sql, triggerCount };
}

function tokenDelta(line: string) {
  const begins = line.match(/\b(BEGIN|CASE)\b/gi)?.length ?? 0;
  const ends = line.match(/\bEND\b/gi)?.length ?? 0;
  return begins - ends;
}

function compileTrigger(source: string) {
  const match =
    /^\s*CREATE\s+TRIGGER\s+([a-zA-Z0-9_]+)\s+(BEFORE|AFTER)\s+(INSERT|DELETE|UPDATE(?:\s+OF\s+[a-zA-Z0-9_]+)?)\s+ON\s+([a-zA-Z0-9_]+)(?:\s+WHEN\s+([\s\S]*?))?\s+BEGIN\s+([\s\S]*)\s+END;\s*$/i.exec(
      source,
    );
  if (!match) throw new Error(`Unsupported SQLite trigger syntax: ${source.slice(0, 160)}`);
  const [, name, timing, event, table, when, rawBody] = match;
  const operation = event!.split(/\s+/)[0]!.toUpperCase();
  const functionName = `seramet_trigger_${name}`;
  const guardedBody = [
    when
      ? `IF NOT (${when.trim()}) THEN RETURN ${operation === "DELETE" ? "OLD" : "NEW"}; END IF;`
      : "",
    compileTriggerBody(rawBody!.trim()),
    `RETURN ${operation === "DELETE" ? "OLD" : "NEW"};`,
  ]
    .filter(Boolean)
    .join("\n");
  return `CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
${indent(guardedBody, 2)}
END;
$$;
CREATE TRIGGER ${name}
${timing!.toUpperCase()} ${event!.toUpperCase()} ON ${table}
FOR EACH ROW EXECUTE FUNCTION ${functionName}();`;
}

function compileTriggerBody(body: string) {
  let compiled = body.replace(/SELECT\s+CASE\s+([\s\S]*?)\s+END;/gi, (_full, cases: string) =>
    compileRaiseCases(cases),
  );
  compiled = compiled.replace(
    /SELECT\s+RAISE\(ABORT,\s*'([^']+)'\s*\);/gi,
    (_full, message: string) => `RAISE EXCEPTION '${message.replace(/'/g, "''")}';`,
  );
  return compiled;
}

function compileRaiseCases(cases: string) {
  const branches = Array.from(
    cases.matchAll(/WHEN\s+([\s\S]*?)\s+THEN\s+RAISE\(ABORT,\s*'([^']+)'\s*\)(?=\s+WHEN|\s*$)/gi),
  );
  if (!branches.length) throw new Error(`Unsupported SQLite trigger CASE: ${cases.slice(0, 160)}`);
  return branches
    .map(
      (branch, index) =>
        `${index === 0 ? "IF" : "ELSIF"} ${branch[1]!.trim()} THEN\n  RAISE EXCEPTION '${branch[2]!.replace(/'/g, "''")}';`,
    )
    .concat("END IF;")
    .join("\n");
}

function indent(value: string, spaces: number) {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
