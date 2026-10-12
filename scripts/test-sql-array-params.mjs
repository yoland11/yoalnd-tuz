/**
 * Drizzle's sql`` expands a JS array into "($1, $2)", which Postgres cannot use
 * inside ANY(...) (42846 / 22P02). Server SQL must bind lists with
 * sql.join(...) inside IN (...), or pass an explicit Postgres array literal.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(name)) files.push(path);
  }
};
walk("src/server");
const offenders = [];
for (const file of files) {
  readFileSync(file, "utf8").split("\n").forEach((line, index) => {
    if (/\bany\(\s*\$\{/i.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 120)}`);
  });
}
assert.deepEqual(offenders, [], `array bound inside ANY(\${...}) — use IN (\${sql.join(...)}):\n${offenders.join("\n")}`);

// The replacement renders as a plain parameter list.
const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { sql } = require("drizzle-orm");
const { PgDialect } = require("drizzle-orm/pg-core");
const ids = [3, 5, 8];
const query = new PgDialect().sqlToQuery(sql`select 1 where x in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
assert.equal(query.sql, "select 1 where x in ($1, $2, $3)");
assert.deepEqual(query.params, ids);
console.log(`SQL array parameter safety: ${files.length} server files checked`);
