import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";

// Compare the real migration artifact with the installed Drizzle export. This is
// schema drift/additive-scope validation, NOT PostgreSQL execution evidence.
const generated=spawnSync(process.execPath,["lib/db/node_modules/drizzle-kit/bin.cjs","export","--dialect","postgresql","--schema","lib/db/src/schema/vehicle-partnership.ts"],{encoding:"utf8",env:process.env,maxBuffer:1024*1024});
assert.equal(generated.status,0,generated.stderr||"schema export failed");
const start=generated.stdout.indexOf("CREATE TABLE");assert.ok(start>=0);
// PostgreSQL's default FK update action is NO ACTION. Omit only that redundant
// clause from this artifact; keep the release gate's DML protection unchanged.
const normalize=value=>value.replace(/\r/g,"").replace(/ ON UPDATE no action(?=;)/g,"").trim();
const expected=normalize(generated.stdout.slice(start));
const actual=normalize(readFileSync("lib/db/migrations/0129_vehicle_partnership.sql","utf8").replace(/^--.*\n/gm,""));
assert.ok(!/\bON UPDATE\b/i.test(readFileSync("lib/db/migrations/0129_vehicle_partnership.sql","utf8")),"artifact omits redundant default FK syntax without weakening the global UPDATE safety gate");
assert.equal(actual,expected,"migration and source schema drifted");
const tableNames=[...actual.matchAll(/CREATE TABLE "([^"]+)"/g)].map(match=>match[1]);
assert.equal(tableNames.length,9);assert.ok(tableNames.every(name=>name.startsWith("vehicle_partnership")));
assert.ok(!/\b(?:DROP\s+(?:TABLE|COLUMN|INDEX)|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+")/i.test(actual),"feature migration cannot modify historical data");
for(const match of actual.matchAll(/ALTER TABLE "([^"]+)"/g))assert.ok(tableNames.includes(match[1]),"only newly added feature tables may be altered");
console.log("PASS partnership migration artifact: matches actual Drizzle export, feature-only additive scope, no historical writes");
console.log("LIMITATION: static artifact/drift verification only; not an executed PostgreSQL migration.");
