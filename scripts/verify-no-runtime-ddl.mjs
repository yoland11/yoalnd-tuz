import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const ddl = /\b(?:create\s+(?:table|(?:unique\s+)?index)|alter\s+table|drop\s+(?:table|index))\b/i;
const failures = [];
for (const name of readdirSync("src/server").filter((file) => file.endsWith(".ts"))) {
  const file = `src/server/${name}`;
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  function visit(node) {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && ddl.test(node.text)) {
      const parentText = node.parent.getText(tree).slice(0, 120);
      if (/sql(?:\.raw)?\s*[(]?\s*[`"']?/i.test(parentText)) {
        failures.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}

assert.deepEqual(failures, [], `Runtime DDL remains at: ${failures.join(", ")}`);
const migration = readFileSync("lib/db/migrations/0096_phase2_production_hardening.sql", "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS rate_limit_buckets/i);
assert.match(migration, /VALUES \(96, 'Phase 2 production hardening/i);
console.log("PASS  application server request code performs no DDL");
console.log("PASS  Phase 2 migration includes distributed limiter and schema revision marker");
